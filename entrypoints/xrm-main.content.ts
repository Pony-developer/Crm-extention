import type { ComponentSearchResult, PageBridgeRequest, PageBridgeResponse, WebApiMethod } from '../shared/types';

/** Runs in the page's MAIN world so it can access the Dynamics Xrm runtime. */
export default defineContentScript({
  matches: ['https://*.dynamics.com/*'],
  allFrames: true,
  world: 'MAIN',
  main() {
    const CHANNEL = 'dynamics-toolkit' as const;
    const CACHE_TTL = 24 * 60 * 60 * 1000;
    const MAX_BODY_BYTES = 1024 * 1024;
    const METHODS = new Set<WebApiMethod>(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
    const ACTIONS = new Set<PageBridgeRequest['action']>(['handshake', 'context', 'fields', 'request', 'cancelRequest', 'searchComponents', 'openComponent']);
    const usedRequestIds = new Set<string>();
    const requests = new Map<string, AbortController>();
    let sessionToken: string | undefined;
    let handshakeComplete = false;
    let subscriptionKey = '';
    let unsubscribe: (() => void) | undefined;
    const xrm = () => (window as typeof window & { Xrm?: any }).Xrm;
    const guid = (value?: string) => value?.replace(/[{}]/g, '').toLowerCase();
    const odataString = (value: string) => value.replace(/'/g, "''");
    const post = (response: PageBridgeResponse) => window.postMessage(response, window.location.origin);
    const fail = (id: string, action: PageBridgeResponse['action'], error: string, token = sessionToken ?? '') => post({ channel: CHANNEL, direction: 'response', id, action, token, error });

    async function getCollection(path: string) {
      const response = await fetch(path, { headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } });
      if (!response.ok) throw new Error(`Dataverse search failed (${response.status} ${response.statusText})`);
      return (await response.json()).value as any[];
    }
    const postEvent = (event: string, payload?: unknown) => window.postMessage({ channel: CHANNEL, direction: 'event', event, payload }, window.location.origin);
    function fieldState(attribute: any) { return { name: attribute.getName(), dirty: Boolean(attribute.getIsDirty?.()), value: attribute.getValue?.() }; }
    function subscribe(page: any) {
      const entity = page?.data?.entity; const key = `${entity?.getEntityName?.() ?? ''}:${guid(entity?.getId?.()) ?? ''}`;
      if (!entity || key === subscriptionKey) return; unsubscribe?.(); subscriptionKey = key; const removers: Array<() => void> = [];
      entity.attributes?.forEach((attribute: any) => { const handler = () => postEvent('attribute-change', fieldState(attribute)); attribute.addOnChange?.(handler); removers.push(() => attribute.removeOnChange?.(handler)); });
      const publishAll = (reason: string) => { const fields: unknown[] = []; entity.attributes?.forEach((attribute: any) => fields.push(fieldState(attribute))); postEvent('fields-state', { reason, fields }); };
      const onSave = () => window.setTimeout(() => publishAll('save-complete'), 750); const onPostSave = () => publishAll('save-complete'); const onLoad = () => publishAll('form-load');
      entity.addOnSave?.(onSave); entity.addOnPostSave?.(onPostSave); page.data?.addOnLoad?.(onLoad);
      removers.push(() => entity.removeOnSave?.(onSave), () => entity.removeOnPostSave?.(onPostSave), () => page.data?.removeOnLoad?.(onLoad));
      unsubscribe = () => { removers.splice(0).forEach(remove => remove()); subscriptionKey = ''; };
    }
    async function getMetadata(orgUrl: string, logicalName: string) {
      const cacheKey = `dynamics-toolkit:metadata:${orgUrl}:${logicalName}`;
      try { const cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null'); if (cached?.savedAt > Date.now() - CACHE_TTL && Array.isArray(cached.value)) return cached.value; } catch { /* Fetch fresh metadata. */ }
      const url = `${orgUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')/Attributes?$select=LogicalName,SchemaName,AttributeType,RequiredLevel`;
      const response = await fetch(url, { headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } }); if (!response.ok) return [];
      const value = (await response.json()).value; try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), value })); } catch { /* Storage may be disabled. */ } return value;
    }

    async function onMessage(event: MessageEvent<unknown>) {
      if (event.source !== window || event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
      const candidate = event.data as Record<string, any>;
      if (candidate.channel !== CHANNEL || candidate.direction !== 'request') return;
      const id = typeof candidate.id === 'string' ? candidate.id : '';
      const rawAction = typeof candidate.action === 'string' ? candidate.action : 'unknown';
      const action = ACTIONS.has(rawAction as PageBridgeRequest['action']) ? rawAction as PageBridgeRequest['action'] : 'unknown';
      const suppliedToken = typeof candidate.token === 'string' ? candidate.token : undefined;
      if (!id) return fail('invalid', action, 'A non-empty request ID is required');
      if (usedRequestIds.has(id)) return fail(id, action, 'Request ID has already been used');
      usedRequestIds.add(id);
      if (action === 'unknown') return fail(id, action, `Unknown bridge action: ${rawAction}`);
      if (action === 'handshake') {
        const token = typeof candidate.payload?.token === 'string' ? candidate.payload.token : '';
        if (token.length < 32 || token.length > 256) return fail(id, action, 'Invalid session token');
        if (handshakeComplete) return fail(id, action, 'Bridge session is already initialized');
        sessionToken = token;
        handshakeComplete = true;
        return post({ channel: CHANNEL, direction: 'response', id, action, token, result: { accepted: true } });
      }
      if (!handshakeComplete || !sessionToken || suppliedToken !== sessionToken) return fail(id, action, 'Invalid bridge session token');
      try {
        const payload = candidate.payload;
        if (action === 'cancelRequest') {
          const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
          if (!requestId) throw new Error('A non-empty request ID is required for cancellation');
          const controller = requests.get(requestId);
          controller?.abort();
          const result = requests.delete(requestId);
          return post({ channel: CHANNEL, direction: 'response', id, action, token: sessionToken, result });
        }

        const Xrm = xrm();
        if (!Xrm?.Utility?.getGlobalContext) throw new Error('Dynamics Xrm API is not available in this frame');
        const page = Xrm.Page;
        const entity = page?.data?.entity;
        subscribe(page);
        if (action === 'context') {
          const global = Xrm.Utility.getGlobalContext();
          const result = { connected: true, orgUrl: global.getClientUrl(), orgName: global.organizationSettings?.uniqueName, entityName: entity?.getEntityName(), recordId: guid(entity?.getId()), recordName: entity?.getPrimaryAttributeValue(), formName: page?.ui?.formSelector?.getCurrentItem?.()?.getLabel(), formType: page?.ui?.getFormType(), pageUrl: window.location.href };
          return post({ channel: CHANNEL, direction: 'response', id, action, token: sessionToken, result });
        } else if (action === 'fields') {
          const controlsByAttribute = new Map<string, string[]>();
          page?.ui?.controls?.forEach((control: any) => {
            const attributeName = control.getAttribute?.()?.getName?.();
            const controlName = control.getName?.();
            if (!attributeName || !controlName) return;
            const names = controlsByAttribute.get(attributeName) ?? [];
            if (!names.includes(controlName)) names.push(controlName);
            controlsByAttribute.set(attributeName, names);
          });
          const liveAttributes: any[] = [];
          entity?.attributes?.forEach((attribute: any) => liveAttributes.push({
            ...fieldState(attribute),
            type: attribute.getAttributeType(),
            required: attribute.getRequiredLevel(),
            controlNames: controlsByAttribute.get(attribute.getName()) ?? [],
          }));
          const logicalName = entity?.getEntityName?.();
          const orgUrl = Xrm.Utility.getGlobalContext().getClientUrl().replace(/\/$/, '');
          const metadata = new Map<string, any>((logicalName ? await getMetadata(orgUrl, logicalName) : []).map((item: any) => [item.LogicalName, item]));
          const result = liveAttributes.map(attribute => {
            const item = metadata.get(attribute.name);
            return { ...attribute, schema: item?.SchemaName ?? attribute.name, type: item?.AttributeType ?? attribute.type, required: item?.RequiredLevel?.Value ?? attribute.required };
          });
          return post({ channel: CHANNEL, direction: 'response', id, action, token: sessionToken, result });
        } else if (action === 'request') {
          if (!payload || typeof payload !== 'object') throw new Error('Invalid request payload');
          const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
          const method = typeof payload.method === 'string' ? payload.method.toUpperCase() as WebApiMethod : '' as WebApiMethod;
          const path = typeof payload.path === 'string' ? payload.path : '';
          const body = typeof payload.body === 'string' ? payload.body : undefined;
          if (!requestId) throw new Error('A non-empty Dataverse request ID is required');
          if (requests.has(requestId)) throw new Error('Dataverse request ID is already active');
          if (!METHODS.has(method)) throw new Error(`HTTP method is not allowed: ${method || '(missing)'}`);
          if (!path.startsWith('/api/data/') || path.startsWith('//') || path.includes('\\')) throw new Error('Only relative /api/data/ paths are allowed');
          const clientUrl = new URL(Xrm.Utility.getGlobalContext().getClientUrl());
          const requestUrl = new URL(path, `${clientUrl.origin}/`);
          if (requestUrl.origin !== clientUrl.origin || !requestUrl.pathname.startsWith('/api/data/')) throw new Error('Dataverse URL is outside the current organization');
          if (body && new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
          if (body && !['POST', 'PATCH', 'PUT'].includes(method)) throw new Error(`${method} requests cannot contain a body`);
          const controller = new AbortController();
          requests.set(requestId, controller);
          const headers = new Headers({ Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' });
          for (const header of payload.headers ?? []) if (header.name.trim()) headers.set(header.name.trim(), header.value);
          if (['POST', 'PATCH', 'PUT'].includes(method) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
          try {
            const response = await fetch(requestUrl, { method, headers, body, signal: controller.signal });
            const result = { status: response.status, statusText: response.statusText, body: await response.text() };
            return post({ channel: CHANNEL, direction: 'response', id, action, token: sessionToken, result });
          } finally {
            if (requests.get(requestId) === controller) requests.delete(requestId);
          }
        } else if (action === 'searchComponents') {
          const query = String(payload?.query ?? '').trim();
          const limit = Math.min(Math.max(Number(payload?.limit) || 20, 1), 50);
          let result: ComponentSearchResult[];
          if (!query) {
            result = [];
          } else {
            const term = odataString(query);
            const take = Math.min(limit, 10);
            const api = '/api/data/v9.2';
            const filter = (field: string) => encodeURIComponent(`contains(${field},'${term}')`);
            const [tables, forms, savedViews, personalViews, steps, flows] = await Promise.all([
              getCollection(`${api}/EntityDefinitions?$select=MetadataId,LogicalName,SchemaName,DisplayName&$filter=${filter('LogicalName')}&$top=${take}`),
              getCollection(`${api}/systemforms?$select=formid,name,objecttypecode,type&$filter=${filter('name')}&$top=${take}`),
              getCollection(`${api}/savedqueries?$select=savedqueryid,name,returnedtypecode&$filter=${filter('name')}&$top=${take}`),
              getCollection(`${api}/userqueries?$select=userqueryid,name,returnedtypecode&$filter=${filter('name')}&$top=${take}`),
              getCollection(`${api}/sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,stage,mode&$filter=${filter('name')}&$top=${take}`),
              getCollection(`${api}/workflows?$select=workflowid,name,statecode,statuscode&$filter=category%20eq%205%20and%20${filter('name')}&$top=${take}`),
            ]);
            const clientUrl = Xrm.Utility.getGlobalContext().getClientUrl();
            const label = (item: any) => item.DisplayName?.UserLocalizedLabel?.Label || item.SchemaName || item.LogicalName;
            const matches: ComponentSearchResult[] = [
              ...tables.map(item => ({ id: guid(item.MetadataId)!, type: 'table' as const, name: label(item), subtitle: item.LogicalName, url: `${clientUrl}/tools/systemcustomization/Entities/EntityEditor.aspx?id=${guid(item.MetadataId)}` })),
              ...forms.map(item => ({ id: guid(item.formid)!, type: 'form' as const, name: item.name, subtitle: String(item.objecttypecode ?? ''), entityName: 'systemform' })),
              ...savedViews.map(item => ({ id: guid(item.savedqueryid)!, type: 'view' as const, name: item.name, subtitle: `System view · ${item.returnedtypecode ?? ''}`, entityName: 'savedquery' })),
              ...personalViews.map(item => ({ id: guid(item.userqueryid)!, type: 'view' as const, name: item.name, subtitle: `Personal view · ${item.returnedtypecode ?? ''}`, entityName: 'userquery' })),
              ...steps.map(item => ({ id: guid(item.sdkmessageprocessingstepid)!, type: 'plugin-step' as const, name: item.name, subtitle: `Stage ${item.stage} · ${item.mode === 0 ? 'Synchronous' : 'Asynchronous'}`, entityName: 'sdkmessageprocessingstep' })),
              ...flows.map(item => ({ id: guid(item.workflowid)!, type: 'cloud-flow' as const, name: item.name, subtitle: item.statecode === 1 ? 'Activated' : 'Draft', entityName: 'workflow' })),
            ];
            result = matches.slice(0, limit);
          }
          return post({ channel: CHANNEL, direction: 'response', id, action, token: sessionToken, result });
        } else if (action === 'openComponent') {
          if (payload?.url) {
            window.open(payload.url, '_blank', 'noopener');
          } else if (payload?.entityName && payload?.id) {
            await Xrm.Navigation.openForm({ entityName: payload.entityName, entityId: guid(payload.id), openInNewWindow: true });
          } else {
            throw new Error('This component does not have a valid navigation target');
          }
          return post({ channel: CHANNEL, direction: 'response', id, action, token: sessionToken, result: true });
        }
      } catch (error) {
        return fail(id, action, error instanceof Error ? error.message : String(error));
      }
    }
    const bridgeWindow = window as typeof window & { __dynamicsToolkitTeardown?: () => void };
    bridgeWindow.__dynamicsToolkitTeardown?.();
    const teardown = () => { window.removeEventListener('message', onMessage); window.removeEventListener('pagehide', teardown); unsubscribe?.(); requests.forEach(controller => controller.abort()); requests.clear(); usedRequestIds.clear(); sessionToken = undefined; handshakeComplete = false; delete bridgeWindow.__dynamicsToolkitTeardown; };
    bridgeWindow.__dynamicsToolkitTeardown = teardown;
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', teardown, { once: true });
  },
});
