/** Runs in the page's MAIN world so it can access the Dynamics Xrm runtime. */
export default defineContentScript({
  matches: ['https://*.dynamics.com/*'],
  allFrames: true,
  world: 'MAIN',
  main() {
    const CHANNEL = 'dynamics-toolkit';
    const RETRY_DELAYS = [100, 200, 400, 800, 1200] as const;
    const xrm = () => (window as typeof window & { Xrm?: any }).Xrm;
    const guid = (value?: string) => value?.replace(/[{}]/g, '').toLowerCase();
    const sleep = (delay: number) => new Promise(resolve => setTimeout(resolve, delay));

    /** Prefer the context supplied by a Dynamics form event. Xrm.Page is legacy-only. */
    function getFormContext(executionContext?: any) {
      const eventFormContext = executionContext?.getFormContext?.();
      if (eventFormContext?.data?.entity) return eventFormContext;
      // Legacy fallback for calls (such as postMessage requests) that cannot carry an execution context.
      return xrm()?.Page;
    }

    async function waitForFormContext(executionContext?: any) {
      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        const Xrm = xrm();
        const formContext = getFormContext(executionContext);
        if (Xrm?.Utility?.getGlobalContext && formContext?.data?.entity?.getEntityName?.()) return formContext;
        const retryDelay = RETRY_DELAYS[attempt];
        if (retryDelay !== undefined) await sleep(retryDelay);
      }
      throw new Error('Dynamics entity form is not available in this frame');
    }

    function readContext(formContext: any) {
      const Xrm = xrm();
      const entity = formContext.data.entity;
      const global = Xrm.Utility.getGlobalContext();
      const formItem = formContext.ui?.formSelector?.getCurrentItem?.();
      return {
        connected: true,
        orgUrl: global.getClientUrl(),
        orgName: global.organizationSettings?.uniqueName,
        entityName: entity.getEntityName?.(),
        recordId: guid(entity.getId?.()),
        recordName: entity.getPrimaryAttributeValue?.(),
        formId: guid(formItem?.getId?.()),
        formName: formItem?.getLabel?.(),
        formType: formContext.ui?.getFormType?.(),
      };
    }

    async function readFields(formContext: any) {
      const liveAttributes: any[] = [];
      formContext.data.entity.attributes?.forEach((attribute: any) => {
        liveAttributes.push({
          name: attribute.getName(),
          type: attribute.getAttributeType(),
          required: attribute.getRequiredLevel(),
          dirty: attribute.getIsDirty(),
        });
      });
      const logicalName = formContext.data.entity.getEntityName?.();
      let metadata = new Map<string, any>();
      if (logicalName) {
        const url = `/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')/Attributes?$select=LogicalName,SchemaName,AttributeType,RequiredLevel`;
        const response = await fetch(url, { headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } });
        if (response.ok) {
          const json = await response.json();
          metadata = new Map(json.value.map((item: any) => [item.LogicalName, item]));
        }
      }
      return liveAttributes.map(attribute => {
        const item = metadata.get(attribute.name);
        return { ...attribute, schema: item?.SchemaName ?? attribute.name, type: item?.AttributeType ?? attribute.type, required: item?.RequiredLevel?.Value ?? attribute.required };
      });
    }

    let activeForm: any;
    let activeSignature = '';
    let listenerDisposers: Array<() => void> = [];
    let refreshTimer: number | undefined;
    let refreshRunning = false;
    let refreshAgain = false;

    const signatureOf = (context: ReturnType<typeof readContext>) =>
      [context.orgUrl, context.entityName, context.recordId, context.formId].join('|');

    function removeFormListeners() {
      listenerDisposers.splice(0).forEach(dispose => dispose());
      activeForm = undefined;
    }

    function attachFormListeners(formContext: any) {
      removeFormListeners();
      activeForm = formContext;
      const onAttributeChange = (executionContext: any) => void publishFieldState(executionContext);
      formContext.data.entity.attributes?.forEach((attribute: any) => {
        attribute.addOnChange?.(onAttributeChange);
        listenerDisposers.push(() => attribute.removeOnChange?.(onAttributeChange));
      });
      const onFormEvent = (executionContext: any) => scheduleRefresh(executionContext, 0);
      formContext.data.addOnLoad?.(onFormEvent);
      if (formContext.data.removeOnLoad) listenerDisposers.push(() => formContext.data.removeOnLoad(onFormEvent));
      formContext.data.entity.addOnSave?.(onFormEvent);
      if (formContext.data.entity.removeOnSave) listenerDisposers.push(() => formContext.data.entity.removeOnSave(onFormEvent));
    }

    async function publishFieldState(executionContext?: any) {
      const formContext = getFormContext(executionContext) ?? activeForm;
      if (!formContext?.data?.entity) return;
      const fields = await readFields(formContext).catch(() => []);
      window.postMessage({ channel: CHANNEL, direction: 'event', type: 'FIELD_STATE_CHANGED', fields }, '*');
    }

    async function refresh(executionContext?: any) {
      if (refreshRunning) { refreshAgain = true; return; }
      refreshRunning = true;
      try {
        const formContext = await waitForFormContext(executionContext);
        const context = readContext(formContext);
        const signature = signatureOf(context);
        if (signature !== activeSignature || formContext !== activeForm) {
          const fields = await readFields(formContext).catch(() => []);
          removeFormListeners();
          activeSignature = signature;
          attachFormListeners(formContext);
          window.postMessage({ channel: CHANNEL, direction: 'event', type: 'CONTEXT_CHANGED', context, fields }, '*');
        }
      } catch {
        // Polling below will retry when the UCI form finishes mounting.
      } finally {
        refreshRunning = false;
        if (refreshAgain) { refreshAgain = false; scheduleRefresh(undefined, 0); }
      }
    }

    function scheduleRefresh(executionContext?: any, delay = 75) {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(executionContext), delay);
    }

    window.addEventListener('popstate', () => scheduleRefresh());
    window.addEventListener('hashchange', () => scheduleRefresh());
    let lastLocation = location.href;
    window.setInterval(() => {
      const locationChanged = lastLocation !== location.href;
      lastLocation = location.href;
      const formContext = getFormContext();
      let formChanged = false;
      if (formContext?.data?.entity) {
        try { formChanged = signatureOf(readContext(formContext)) !== activeSignature || formContext !== activeForm; } catch { /* form is between SPA states */ }
      }
      if (locationChanged || formChanged) scheduleRefresh();
    }, 750);
    scheduleRefresh(undefined, 0);

    window.addEventListener('message', async (event) => {
      if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'request') return;
      const { id, action, payload } = event.data;
      try {
        const formContext = await waitForFormContext();
        let result: unknown;
        if (action === 'context') result = readContext(formContext);
        else if (action === 'fields') result = await readFields(formContext);
        else if (action === 'request') {
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
