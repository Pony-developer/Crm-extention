import type { BridgeRequest, BridgeResponse, DataverseMethod, FieldInfo, XrmApi } from '../shared/types';

/** Runs in the page's MAIN world so it can access the Dynamics Xrm runtime. */
export default defineContentScript({
  matches: ['https://*.dynamics.com/*'],
  allFrames: true,
  world: 'MAIN',
  main() {
    const CHANNEL = 'dynamics-toolkit' as const;
    const MAX_BODY_BYTES = 1024 * 1024;
    const METHODS = new Set<DataverseMethod>(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
    const ACTIONS = new Set(['handshake', 'context', 'fields', 'request']);
    const usedRequestIds = new Set<string>();
    let sessionToken: string | undefined;
    const xrm = () => (window as typeof window & { Xrm?: XrmApi }).Xrm;
    const guid = (value?: string) => value?.replace(/[{}]/g, '').toLowerCase();

    const post = (response: BridgeResponse) => window.postMessage(response, window.location.origin);
    const fail = (id: string, action: BridgeResponse['action'], error: string, token?: string) =>
      post({ channel: CHANNEL, direction: 'response', id, action, token, error });

    const onMessage = async (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!event.data || typeof event.data !== 'object') return;
      const candidate = event.data as Record<string, unknown>;
      if (candidate.channel !== CHANNEL || candidate.direction !== 'request') return;

      const id = typeof candidate.id === 'string' ? candidate.id : '';
      const rawAction = typeof candidate.action === 'string' ? candidate.action : 'unknown';
      const action = ACTIONS.has(rawAction) ? rawAction as BridgeRequest['action'] : 'unknown';
      const suppliedToken = typeof candidate.token === 'string' ? candidate.token : undefined;
      if (!id) return fail('invalid', action, 'A non-empty request ID is required', suppliedToken);
      if (usedRequestIds.has(id)) return fail(id, action, 'Request ID has already been used', suppliedToken);
      usedRequestIds.add(id);
      if (action === 'unknown') return fail(id, action, `Unknown bridge action: ${rawAction}`, suppliedToken);

      if (action === 'handshake') {
        const payload = candidate.payload;
        const token = payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).token === 'string'
          ? (payload as { token: string }).token : '';
        if (token.length < 32 || token.length > 256) return fail(id, action, 'Invalid session token');
        if (sessionToken) return fail(id, action, 'Bridge session is already initialized');
        sessionToken = token;
        post({ channel: CHANNEL, direction: 'response', id, action, token, result: { accepted: true } });
        return;
      }
      if (!sessionToken || suppliedToken !== sessionToken) return fail(id, action, 'Invalid bridge session token', suppliedToken);

      try {
        const Xrm = xrm();
        const global = Xrm?.Utility?.getGlobalContext?.();
        if (!global) throw new Error('Dynamics Xrm API is not available in this frame');
        const page = Xrm?.Page;

        if (action === 'context') {
          const entity = page?.data?.entity;
          post({ channel: CHANNEL, direction: 'response', id, action, token: sessionToken, result: {
            connected: true,
            orgUrl: global.getClientUrl(),
            orgName: global.organizationSettings?.uniqueName,
            entityName: entity?.getEntityName?.(),
            recordId: guid(entity?.getId?.()),
            recordName: entity?.getPrimaryAttributeValue?.(),
            formName: page?.ui?.formSelector?.getCurrentItem?.()?.getLabel?.(),
            formType: page?.ui?.getFormType?.(),
          } });
          return;
        }

        if (action === 'fields') {
          const liveAttributes: Omit<FieldInfo, 'schema'>[] = [];
          page?.data?.entity?.attributes?.forEach(attribute => liveAttributes.push({
            name: attribute.getName(), type: attribute.getAttributeType(),
            required: attribute.getRequiredLevel(), dirty: attribute.getIsDirty(),
          }));
          const logicalName = page?.data?.entity?.getEntityName?.();
          type Metadata = { LogicalName: string; SchemaName?: string; AttributeType?: string; RequiredLevel?: { Value?: string } };
          let metadata = new Map<string, Metadata>();
          if (logicalName) {
            const path = `/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')/Attributes?$select=LogicalName,SchemaName,AttributeType,RequiredLevel`;
            const response = await fetch(new URL(path, global.getClientUrl()), { headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } });
            if (response.ok) {
              const json = await response.json() as { value?: Metadata[] };
              metadata = new Map((json.value ?? []).map(item => [item.LogicalName, item]));
            }
          }
          const result: FieldInfo[] = liveAttributes.map(attribute => {
            const item = metadata.get(attribute.name);
            return { ...attribute, schema: item?.SchemaName ?? attribute.name, type: item?.AttributeType ?? attribute.type, required: item?.RequiredLevel?.Value ?? attribute.required };
          });
          post({ channel: CHANNEL, direction: 'response', id, action, token: sessionToken, result });
          return;
        }

        if (!candidate.payload || typeof candidate.payload !== 'object') throw new Error('Invalid request payload');
        const payload = candidate.payload as Record<string, unknown>;
        const method = payload && typeof payload.method === 'string' ? payload.method.toUpperCase() : '';
        const path = payload && typeof payload.path === 'string' ? payload.path : '';
        const body = payload && typeof payload.body === 'string' ? payload.body : undefined;
        if (!METHODS.has(method as DataverseMethod)) throw new Error(`HTTP method is not allowed: ${method || '(missing)'}`);
        if (!path.startsWith('/api/data/') || path.startsWith('//') || path.includes('\\')) throw new Error('Only relative /api/data/ paths are allowed');
        const clientUrl = new URL(global.getClientUrl());
        const requestUrl = new URL(path, `${clientUrl.origin}/`);
        if (requestUrl.origin !== clientUrl.origin || !requestUrl.pathname.startsWith('/api/data/')) throw new Error('Dataverse URL is outside the current organization');
        if (body && new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
        if (body && !['POST', 'PATCH', 'PUT'].includes(method)) throw new Error(`${method} requests cannot contain a body`);
        const response = await fetch(requestUrl, {
          method,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
          body,
        });
        post({ channel: CHANNEL, direction: 'response', id, action, token: sessionToken, result: { status: response.status, statusText: response.statusText, body: await response.text() } });
      } catch (error) {
        fail(id, action, error instanceof Error ? error.message : String(error), sessionToken);
      }
    };

    const bridgeWindow = window as typeof window & { __dynamicsToolkitTeardown?: () => void };
    bridgeWindow.__dynamicsToolkitTeardown?.();
    const teardown = () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', teardown);
      usedRequestIds.clear();
      sessionToken = undefined;
      delete bridgeWindow.__dynamicsToolkitTeardown;
    };
    bridgeWindow.__dynamicsToolkitTeardown = teardown;
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', teardown, { once: true });
  },
});
