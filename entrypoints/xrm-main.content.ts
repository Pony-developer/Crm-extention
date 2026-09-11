/** Runs in the page's MAIN world so it can access the Dynamics Xrm runtime. */
export default defineContentScript({
  matches: ['https://*.dynamics.com/*'],
  allFrames: true,
  world: 'MAIN',
  main() {
    const CHANNEL = 'dynamics-toolkit';
    const xrm = () => (window as typeof window & { Xrm?: any }).Xrm;
    const guid = (value?: string) => value?.replace(/[{}]/g, '').toLowerCase();

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
          const app = await global.getCurrentAppProperties?.().catch(() => undefined);
          result = {
            connected: true,
            orgUrl: global.getClientUrl(),
            orgName: global.organizationSettings?.uniqueName,
            entityName: entity?.getEntityName(),
            recordId: guid(entity?.getId()),
            recordName: entity?.getPrimaryAttributeValue(),
            formName: page?.ui?.formSelector?.getCurrentItem?.()?.getLabel(),
            formType: page?.ui?.getFormType(),
            appId: app?.appId,
            appUniqueName: app?.uniqueName,
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
