/** Runs in the page's MAIN world so it can access the Dynamics Xrm runtime. */
export default defineContentScript({
  matches: ['https://*.dynamics.com/*'],
  allFrames: true,
  world: 'MAIN',
  main() {
    const CHANNEL = 'dynamics-toolkit';
    const xrm = () => (window as typeof window & { Xrm?: any }).Xrm;
    const guid = (value?: string) => value?.replace(/[{}]/g, '').toLowerCase();
    const requests = new Map<string, AbortController>();

    window.addEventListener('message', async (event) => {
      if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'request') return;
      const { id, action, payload } = event.data;
      try {
        const Xrm = xrm();
        if (!Xrm?.Utility?.getGlobalContext) throw new Error('Dynamics Xrm API is not available in this frame');
        const page = Xrm.Page;
        let result: unknown;
        if (action === 'context') {
          const entity = page?.data?.entity;
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
          const liveAttributes: any[] = [];
          page?.data?.entity?.attributes?.forEach((attribute: any) => {
            liveAttributes.push({
              name: attribute.getName(),
              type: attribute.getAttributeType(),
              required: attribute.getRequiredLevel(),
              dirty: attribute.getIsDirty(),
            });
          });
          const logicalName = page?.data?.entity?.getEntityName?.();
          let metadata = new Map<string, any>();
          if (logicalName) {
            const url = `/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')/Attributes?$select=LogicalName,SchemaName,AttributeType,RequiredLevel`;
            const response = await fetch(url, { headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } });
            if (response.ok) {
              const json = await response.json();
              metadata = new Map(json.value.map((item: any) => [item.LogicalName, item]));
            }
          }
          result = liveAttributes.map(attribute => {
            const item = metadata.get(attribute.name);
            return { ...attribute, schema: item?.SchemaName ?? attribute.name, type: item?.AttributeType ?? attribute.type, required: item?.RequiredLevel?.Value ?? attribute.required };
          });
        } else if (action === 'request') {
          const controller = new AbortController();
          requests.set(payload.requestId, controller);
          const headers = new Headers({ Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' });
          for (const header of payload.headers ?? []) if (header.name.trim()) headers.set(header.name.trim(), header.value);
          if (['POST', 'PATCH', 'PUT'].includes(payload.method) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
          const response = await fetch(payload.path, {
            method: payload.method,
            headers,
            body: ['POST', 'PATCH', 'PUT'].includes(payload.method) && payload.body ? payload.body : undefined,
            signal: controller.signal,
          });
          result = { status: response.status, statusText: response.statusText, body: await response.text() };
          requests.delete(payload.requestId);
        } else if (action === 'cancelRequest') {
          requests.get(payload.requestId)?.abort();
          requests.delete(payload.requestId);
          result = { cancelled: true };
        }
        window.postMessage({ channel: CHANNEL, direction: 'response', id, result }, '*');
      } catch (error) {
        if (event.data?.payload?.requestId) requests.delete(event.data.payload.requestId);
        window.postMessage({ channel: CHANNEL, direction: 'response', id, error: error instanceof Error ? error.message : String(error) }, '*');
      }
    });
  },
});
