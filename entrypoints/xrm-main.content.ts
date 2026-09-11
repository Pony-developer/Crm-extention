/** Runs in the page's MAIN world so it can access the Dynamics Xrm runtime. */
export default defineContentScript({
  matches: ['https://*.dynamics.com/*'],
  allFrames: true,
  world: 'MAIN',
  main() {
    const CHANNEL = 'dynamics-toolkit';
    const xrm = () => (window as typeof window & { Xrm?: any }).Xrm;
    const guid = (value?: string) => value?.replace(/[{}]/g, '').toLowerCase();

    type Field = { name: string; schema: string; type: string; required: string; attribute: any };
    type Difference = Omit<Field, 'attribute'> & { dirty: true; serverValue: unknown; currentValue: unknown };
    type Snapshot = Map<string, unknown>;

    let fields: Field[] = [];
    let baseline: Snapshot = new Map();
    let baselineReady = false;
    let recordKey = '';
    let initialization: Promise<void> | undefined;
    let refreshSequence = 0;
    const hookedAttributes = new WeakSet<object>();
    const hookedEntities = new WeakSet<object>();
    const hookedData = new WeakSet<object>();

    // Missing Web API properties and explicit nulls both mean "no value". Empty strings
    // remain empty strings, so clearing a null text field to "" is still a difference.
    const absent = (value: unknown) => value === null || value === undefined ? null : value;
    const number = (value: unknown) => {
      if (value === null || value === undefined || value === '') return absent(value);
      const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : String(value);
    };
    const isoUtc = (value: unknown) => {
      if (value === null || value === undefined || value === '') return absent(value);
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
    };
    const lookup = (value: unknown) => {
      const items = Array.isArray(value) ? value : value ? [value] : [];
      if (!items.length) return null;
      return items.map((item: any) => ({
        id: guid(item?.id ?? item?.value) ?? '',
        logicalName: String(item?.entityType ?? item?.logicalName ?? '').toLowerCase(),
      })).sort((a, b) => `${a.logicalName}:${a.id}`.localeCompare(`${b.logicalName}:${b.id}`));
    };
    const normalize = (type: string, value: unknown) => {
      const kind = type.toLowerCase();
      if (kind === 'lookup' || kind === 'customer' || kind === 'owner') return lookup(value);
      if (['picklist', 'state', 'status', 'optionset', 'choice', 'integer', 'bigint'].includes(kind)) return number(value);
      if (kind === 'datetime' || kind === 'date') return isoUtc(value);
      if (['money', 'decimal', 'double'].includes(kind)) return number(value);
      if (kind === 'multiselectpicklist' || kind === 'multiselectoptionset') {
        if (value === null || value === undefined) return null;
        const values = Array.isArray(value) ? value : String(value).split(',');
        return [...new Set(values.map(number) as (number | string)[])].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      }
      return absent(value);
    };
    const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
    const display = (value: unknown) => value === undefined ? 'undefined' : value === null ? 'null' : value === '' ? '""' :
      typeof value === 'string' ? value : JSON.stringify(value);

    function differences(): Difference[] {
      if (!baselineReady) return [];
      return fields.flatMap(field => {
        const serverValue = baseline.get(field.name);
        const currentValue = normalize(field.type, field.attribute.getValue?.());
        return same(serverValue, currentValue) ? [] : [{
          name: field.name, schema: field.schema, type: field.type, required: field.required, dirty: true,
          serverValue: display(serverValue), currentValue: display(currentValue),
        }];
      });
    }

    function publishDifferences() {
      window.postMessage({ channel: CHANNEL, direction: 'event', action: 'fieldsChanged', result: differences() }, '*');
    }

    async function loadServerSnapshot(sequence = refreshSequence) {
      const Xrm = xrm();
      const entity = Xrm.Page?.data?.entity;
      const entityName = entity?.getEntityName?.();
      const id = guid(entity?.getId?.());
      if (!entityName || !id || !fields.length) { baseline = new Map(); baselineReady = false; publishDifferences(); return; }

      const metadataUrl = `/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(entityName)}')?$select=EntitySetName`;
      const metadataResponse = await fetch(metadataUrl, { headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } });
      if (!metadataResponse.ok) throw new Error(`Unable to resolve entity set (${metadataResponse.status})`);
      const { EntitySetName: entitySetName } = await metadataResponse.json();
      const select = fields.map(field => ['lookup', 'customer', 'owner'].includes(field.type.toLowerCase()) ? `_${field.name}_value` : field.name);
      const recordUrl = `/api/data/v9.2/${encodeURIComponent(entitySetName)}(${id})?$select=${select.map(encodeURIComponent).join(',')}`;
      const response = await fetch(recordUrl, {
        headers: { Accept: 'application/json', Prefer: 'odata.include-annotations="Microsoft.Dynamics.CRM.lookuplogicalname"', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
      });
      if (!response.ok) throw new Error(`Unable to load server snapshot (${response.status})`);
      const record = await response.json();
      const next = new Map<string, unknown>();
      for (const field of fields) {
        const lookupKey = `_${field.name}_value`;
        const raw = ['lookup', 'customer', 'owner'].includes(field.type.toLowerCase())
          ? record[lookupKey] == null ? null : [{ id: record[lookupKey], entityType: record[`${lookupKey}@Microsoft.Dynamics.CRM.lookuplogicalname`] }]
          : record[field.name];
        next.set(field.name, normalize(field.type, raw));
      }
      // A slower refresh must never replace a baseline loaded by a newer one.
      if (sequence !== refreshSequence) return;
      baseline = next;
      baselineReady = true;
      publishDifferences();
    }

    async function refreshBaseline() {
      const sequence = ++refreshSequence;
      await loadServerSnapshot(sequence);
    }

    async function initialize() {
      const Xrm = xrm();
      const page = Xrm.Page;
      const entity = page?.data?.entity;
      const nextKey = `${entity?.getEntityName?.() ?? ''}:${guid(entity?.getId?.()) ?? ''}`;
      if (nextKey === recordKey && fields.length) return;
      recordKey = nextKey;
      fields = [];
      baseline = new Map();
      baselineReady = false;

      const liveAttributes: any[] = [];
      entity?.attributes?.forEach((attribute: any) => liveAttributes.push(attribute));
      const logicalName = entity?.getEntityName?.();
      let metadata = new Map<string, any>();
      if (logicalName) {
        const url = `/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')/Attributes?$select=LogicalName,SchemaName,AttributeType,RequiredLevel`;
        const response = await fetch(url, { headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } });
        if (response.ok) {
          const json = await response.json();
          metadata = new Map(json.value.map((item: any) => [item.LogicalName, item]));
        }
      }
      fields = liveAttributes.map(attribute => {
        const item = metadata.get(attribute.getName());
        return {
          name: attribute.getName(), schema: item?.SchemaName ?? attribute.getName(),
          type: item?.AttributeType ?? attribute.getAttributeType(),
          required: item?.RequiredLevel?.Value ?? attribute.getRequiredLevel(), attribute,
        };
      });
      await loadServerSnapshot();

      for (const field of fields) if (!hookedAttributes.has(field.attribute)) {
        field.attribute.addOnChange?.(publishDifferences);
        hookedAttributes.add(field.attribute);
      }
      if (entity && !hookedEntities.has(entity)) {
        entity.addOnPostSave?.((context: any) => {
          const saveError = context?.getEventArgs?.()?.getSaveErrorInfo?.();
          if (!saveError || !saveError.errorCode) void refreshBaseline().catch(() => undefined);
        });
        hookedEntities.add(entity);
      }
      if (page?.data && !hookedData.has(page.data)) {
        page.data.addOnLoad?.(() => { void refreshBaseline().catch(() => undefined); });
        hookedData.add(page.data);
      }
    }

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
          result = { connected: true, orgUrl: global.getClientUrl(), orgName: global.organizationSettings?.uniqueName, entityName: entity?.getEntityName(), recordId: guid(entity?.getId()), recordName: entity?.getPrimaryAttributeValue(), formName: page?.ui?.formSelector?.getCurrentItem?.()?.getLabel(), formType: page?.ui?.getFormType() };
        } else if (action === 'fields') {
          initialization ??= initialize().finally(() => { initialization = undefined; });
          await initialization;
          result = differences();
        } else if (action === 'request') {
          const response = await fetch(payload.path, { method: payload.method, headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' }, body: ['POST', 'PATCH', 'PUT'].includes(payload.method) && payload.body ? payload.body : undefined });
          result = { status: response.status, statusText: response.statusText, body: await response.text() };
        }
        window.postMessage({ channel: CHANNEL, direction: 'response', id, result }, '*');
      } catch (error) {
        window.postMessage({ channel: CHANNEL, direction: 'response', id, error: error instanceof Error ? error.message : String(error) }, '*');
      }
    });
  },
});
