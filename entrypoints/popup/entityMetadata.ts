import type { AutocompleteOption } from './Autocomplete';

export type FieldMeta = { name: string; logicalName: string; type: string; targets: string[] };
export type EntityMetadata = { logicalName: string; fields: AutocompleteOption[]; fieldIndex: Map<string, FieldMeta>; navigations: AutocompleteOption[] };
export type MetadataGet = (path: string) => Promise<any>;

const API = '/api/data/v9.2';
const LOOKUP_TYPES = new Set(['Lookup', 'Customer', 'Owner']);

/** The entity set name is the first path segment after /api/data/vX.Y/. */
export function entitySetFromPath(path: string) {
  return /^\/api\/data\/v\d+(?:\.\d+)?\/([A-Za-z_][A-Za-z0-9_]*)/.exec(path)?.[1];
}

const collection = (body: any): any[] => Array.isArray(body?.value) ? body.value : [];

export async function loadEntityMetadata(get: MetadataGet, entitySet: string, knownLogicalName?: string): Promise<EntityMetadata> {
  let logicalName = knownLogicalName;
  if (!logicalName) {
    const found = collection(await get(`${API}/EntityDefinitions?$select=LogicalName&$filter=EntitySetName eq '${entitySet.replaceAll("'", "''")}'`))[0];
    logicalName = found?.LogicalName;
    if (!logicalName) throw new Error(`Unknown entity set: ${entitySet}`);
  }
  const base = `${API}/EntityDefinitions(LogicalName='${logicalName.replaceAll("'", "''")}')`;
  const [attributes, manyToOne, oneToMany, manyToMany, lookups] = await Promise.all([
    get(`${base}/Attributes?$select=LogicalName,AttributeType,AttributeOf,DisplayName,IsValidForRead`),
    get(`${base}/ManyToOneRelationships?$select=ReferencingEntityNavigationPropertyName,ReferencedEntity`),
    get(`${base}/OneToManyRelationships?$select=ReferencedEntityNavigationPropertyName,ReferencingEntity`),
    get(`${base}/ManyToManyRelationships?$select=Entity1LogicalName,Entity1NavigationPropertyName,Entity2NavigationPropertyName,Entity2LogicalName`),
    // Targets decide which table a lookup value is searched in; filtering by value still works without them.
    get(`${base}/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,Targets`).catch(() => undefined),
  ]);
  const targets = new Map<string, string[]>(collection(lookups).map(item => [item.LogicalName, Array.isArray(item.Targets) ? item.Targets : []]));
  const fallbackTargets: Record<string, string[]> = { Owner: ['systemuser', 'team'], Customer: ['account', 'contact'] };

  const fieldIndex = new Map<string, FieldMeta>();
  const fields = collection(attributes)
    .filter(attribute => !attribute.AttributeOf && attribute.IsValidForRead !== false && attribute.LogicalName)
    .map((attribute): AutocompleteOption => {
      const name = LOOKUP_TYPES.has(attribute.AttributeType) ? `_${attribute.LogicalName}_value` : attribute.LogicalName;
      const found = targets.get(attribute.LogicalName);
      fieldIndex.set(name, { name, logicalName: attribute.LogicalName, type: attribute.AttributeType, targets: found?.length ? found : fallbackTargets[attribute.AttributeType] ?? [] });
      return {
        // Web API exposes lookups as _name_value in $select and $filter.
        name,
        label: attribute.DisplayName?.UserLocalizedLabel?.Label,
        kind: attribute.AttributeType,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const navigations = new Map<string, AutocompleteOption>();
  const add = (name: unknown, kind: string, target: unknown) => {
    if (typeof name === 'string' && name && !navigations.has(name)) navigations.set(name, { name, label: typeof target === 'string' ? target : undefined, kind });
  };
  collection(manyToOne).forEach(item => add(item.ReferencingEntityNavigationPropertyName, 'N:1', item.ReferencedEntity));
  collection(oneToMany).forEach(item => add(item.ReferencedEntityNavigationPropertyName, '1:N', item.ReferencingEntity));
  collection(manyToMany).forEach(item => item.Entity1LogicalName === logicalName
    ? add(item.Entity1NavigationPropertyName, 'N:N', item.Entity2LogicalName)
    : add(item.Entity2NavigationPropertyName, 'N:N', item.Entity1LogicalName));

  return { logicalName, fields, fieldIndex, navigations: [...navigations.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
