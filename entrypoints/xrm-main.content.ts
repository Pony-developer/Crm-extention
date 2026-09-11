/** Runs in the page's MAIN world so it can access the Dynamics Xrm runtime. */
export default defineContentScript({
  matches: ['https://*.dynamics.com/*'],
  allFrames: true,
  world: 'MAIN',
  main() {
    const CHANNEL = 'dynamics-toolkit';
    const CACHE_TTL = 24 * 60 * 60 * 1000;
    const xrm = () => (window as typeof window & { Xrm?: any }).Xrm;
    const guid = (value?: string) => value?.replace(/[{}]/g, '').toLowerCase();
    let subscriptionKey = '';
    let unsubscribe: (() => void) | undefined;

    const postEvent = (event: string, payload?: unknown) =>
      window.postMessage({ channel: CHANNEL, direction: 'event', event, payload }, '*');

    function fieldState(attribute: any) {
      return {
        name: attribute.getName(),
        dirty: Boolean(attribute.getIsDirty?.()),
        value: attribute.getValue?.(),
      };
    }

    function subscribe(page: any) {
      const entity = page?.data?.entity;
      const key = `${entity?.getEntityName?.() ?? ''}:${guid(entity?.getId?.()) ?? ''}`;
      if (!entity || key === subscriptionKey) return;
      unsubscribe?.();
      subscriptionKey = key;
      const removers: Array<() => void> = [];
      entity.attributes?.forEach((attribute: any) => {
        const handler = () => postEvent('attribute-change', fieldState(attribute));
        attribute.addOnChange?.(handler);
        removers.push(() => attribute.removeOnChange?.(handler));
      });
      const publishAll = (reason: string) => {
        const fields: unknown[] = [];
        entity.attributes?.forEach((attribute: any) => fields.push(fieldState(attribute)));
        postEvent('fields-state', { reason, fields });
      };
      const onSave = (eventContext: any) => {
        postEvent('form-save', { saveMode: eventContext.getEventArgs?.()?.getSaveMode?.() });
        // Autosave clears dirty flags asynchronously. The post-save hook is preferred;
        // this fallback also supports older UCI clients that do not expose it.
        window.setTimeout(() => publishAll('save-complete'), 750);
      };
      const onPostSave = () => publishAll('save-complete');
      const onLoad = () => publishAll('form-load');
      entity.addOnSave?.(onSave);
      entity.addOnPostSave?.(onPostSave);
      page.data?.addOnLoad?.(onLoad);
      removers.push(
        () => entity.removeOnSave?.(onSave),
        () => entity.removeOnPostSave?.(onPostSave),
        () => page.data?.removeOnLoad?.(onLoad),
      );
      unsubscribe = () => { removers.splice(0).forEach(remove => remove()); subscriptionKey = ''; };
    }

    async function getMetadata(orgUrl: string, logicalName: string) {
      const cacheKey = `dynamics-toolkit:metadata:${orgUrl}:${logicalName}`;
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null');
        if (cached?.savedAt > Date.now() - CACHE_TTL && Array.isArray(cached.value)) return cached.value;
      } catch { /* Invalid or inaccessible cache: fetch a fresh copy. */ }
      const url = `${orgUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')/Attributes?$select=LogicalName,SchemaName,AttributeType,RequiredLevel`;
      const response = await fetch(url, { headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } });
      if (!response.ok) return [];
      const value = (await response.json()).value;
      try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), value })); } catch { /* Storage can be disabled. */ }
      return value;
    }

    window.addEventListener('pagehide', () => unsubscribe?.());
    window.addEventListener('message', async (event) => {
      if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'request') return;
      const { id, action, payload } = event.data;
      try {
        const Xrm = xrm();
        if (!Xrm?.Utility?.getGlobalContext) throw new Error('Dynamics Xrm API is not available in this frame');
        const page = Xrm.Page;
        const entity = page?.data?.entity;
        subscribe(page);
        let result: unknown;
        if (action === 'context') {
          const global = Xrm.Utility.getGlobalContext();
          result = {
            connected: true,
            orgUrl: global.getClientUrl(),
            orgName: global.organizationSettings?.uniqueName,
            entityName: entity?.getEntityName(),
            recordId: guid(entity?.getId()),
            recordName: entity?.getPrimaryAttributeValue(),
            formName: page?.ui?.formSelector?.getCurrentItem?.()?.getLabel(),
            formType: page?.ui?.getFormType(),
          };
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
          result = liveAttributes.map(attribute => {
            const item = metadata.get(attribute.name);
            return { ...attribute, schema: item?.SchemaName ?? attribute.name, type: item?.AttributeType ?? attribute.type, required: item?.RequiredLevel?.Value ?? attribute.required };
          });
        } else if (action === 'request') {
          const response = await fetch(payload.path, {
            method: payload.method,
            headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
            body: ['POST', 'PATCH', 'PUT'].includes(payload.method) && payload.body ? payload.body : undefined,
          });
          result = { status: response.status, statusText: response.statusText, body: await response.text() };
        }
        window.postMessage({ channel: CHANNEL, direction: 'response', id, result }, '*');
      } catch (error) {
        window.postMessage({ channel: CHANNEL, direction: 'response', id, error: error instanceof Error ? error.message : String(error) }, '*');
      }
    });
  },
});
