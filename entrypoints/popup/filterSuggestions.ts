import type { AutocompleteOption, SuggestionProvider, Suggestions } from './Autocomplete';
import type { EntityMetadata, MetadataGet } from './entityMetadata';

const API = '/api/data/v9.2';
const COMPARISONS = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le']);
const ORDERED_TYPES = new Set(['Integer', 'BigInt', 'Decimal', 'Double', 'Money', 'DateTime', 'String', 'Memo']);
const OPERATORS: Record<string, string> = {
  eq: 'equals', ne: 'not equals', gt: 'greater than', ge: 'greater or equal', lt: 'less than', le: 'less or equal',
};
const OPTION_SET_TYPES: Record<string, string> = {
  Picklist: 'PicklistAttributeMetadata', Status: 'StatusAttributeMetadata', State: 'StateAttributeMetadata',
};
const LOOKUP_SEARCH_DELAY = 250;
const LOOKUP_RESULTS = 10;

type TargetInfo = { logicalName: string; entitySet: string; idAttribute: string; nameAttribute: string };

/** Index in `text` where the clause being typed starts, i.e. after the last top-level `and`, `or` or `(`. */
function clauseStart(text: string) {
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'") { inQuote = !inQuote; continue; }
    if (inQuote) continue;
    if (char === '(') { start = i + 1; continue; }
    const conjunction = /^\s(?:and|or)\s/i.exec(text.slice(i));
    if (conjunction) { start = i + conjunction[0].length; i += conjunction[0].length - 1; }
  }
  return start;
}

const matches = (option: AutocompleteOption, typed: string) => {
  if (!typed) return true;
  const query = typed.toLowerCase();
  return option.name.toLowerCase().includes(query) || Boolean(option.label?.toLowerCase().includes(query));
};
const rank = (option: AutocompleteOption, typed: string) => (option.name.toLowerCase().startsWith(typed.toLowerCase()) ? 0 : 1);
export const filtered = (options: AutocompleteOption[], typed: string, limit = 50) =>
  options.filter(option => matches(option, typed)).sort((a, b) => rank(a, typed) - rank(b, typed) || a.name.localeCompare(b.name)).slice(0, limit);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/**
 * Builds the $filter completion for one table. It follows the shape of the clause being typed:
 * field name -> operator that fits the field type -> value picked from the field's data -> and/or.
 */
export function createFilterProvider(meta: EntityMetadata, get: MetadataGet, orgKey: string): SuggestionProvider {
  const optionSets = new Map<string, Promise<AutocompleteOption[]>>();
  const targets = new Map<string, Promise<TargetInfo | undefined>>();

  const optionsFor = (attributeLogicalName: string, type: string) => {
    const key = `${orgKey}|${meta.logicalName}|${attributeLogicalName}`;
    let pending = optionSets.get(key);
    if (!pending) {
      const cast = OPTION_SET_TYPES[type];
      pending = get(`${API}/EntityDefinitions(LogicalName='${meta.logicalName}')/Attributes(LogicalName='${attributeLogicalName}')/Microsoft.Dynamics.CRM.${cast}?$select=LogicalName&$expand=OptionSet($select=Options)`)
        .then((body): AutocompleteOption[] => (body?.OptionSet?.Options ?? []).map((option: any) => ({
          name: text(option.Label?.UserLocalizedLabel?.Label) ?? String(option.Value),
          label: String(option.Value),
          kind: type,
          insert: `${option.Value} `,
        })));
      optionSets.set(key, pending);
      pending.catch(() => { if (optionSets.get(key) === pending) optionSets.delete(key); });
    }
    return pending;
  };

  const targetInfo = (logicalName: string) => {
    const key = `${orgKey}|${logicalName}`;
    let pending = targets.get(key);
    if (!pending) {
      pending = get(`${API}/EntityDefinitions(LogicalName='${logicalName}')?$select=EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute`)
        .then((body): TargetInfo | undefined => body?.EntitySetName && body.PrimaryIdAttribute && body.PrimaryNameAttribute
          ? { logicalName, entitySet: body.EntitySetName, idAttribute: body.PrimaryIdAttribute, nameAttribute: body.PrimaryNameAttribute }
          : undefined);
      targets.set(key, pending);
      pending.catch(() => { if (targets.get(key) === pending) targets.delete(key); });
    }
    return pending;
  };

  const searchRecords = async (targetNames: string[], typed: string, isStale: () => boolean): Promise<AutocompleteOption[]> => {
    await sleep(LOOKUP_SEARCH_DELAY);
    if (isStale()) return [];
    const needle = typed.replace(/^'/, '').replace(/'$/, '');
    const groups = await Promise.all(targetNames.slice(0, 3).map(async name => {
      const info = await targetInfo(name).catch(() => undefined);
      if (!info) return [];
      const where = needle ? `&$filter=contains(${info.nameAttribute},'${encodeURIComponent(needle.replaceAll("'", "''"))}')` : '';
      const body = await get(`${API}/${info.entitySet}?$select=${info.idAttribute},${info.nameAttribute}&$orderby=${info.nameAttribute}&$top=${LOOKUP_RESULTS}${where}`).catch(() => undefined);
      return ((body?.value ?? []) as Array<Record<string, unknown>>).map((record): AutocompleteOption => ({
        name: text(record[info.nameAttribute]) || '(no name)',
        label: String(record[info.idAttribute]),
        kind: info.logicalName,
        insert: `${record[info.idAttribute]} `,
      }));
    }));
    return groups.flat().slice(0, LOOKUP_RESULTS);
  };

  const operatorItems = (type: string, typed: string): AutocompleteOption[] => {
    const names = ORDERED_TYPES.has(type) ? [...COMPARISONS] : ['eq', 'ne'];
    return filtered(names.map(name => ({ name, label: OPERATORS[name], insert: `${name} ` })), typed);
  };

  const nullItem: AutocompleteOption = { name: 'null', label: 'empty value', insert: 'null ' };

  const valueSuggestions = async (fieldName: string, typed: string, from: number, isStale: () => boolean): Promise<Suggestions | null> => {
    const field = meta.fieldIndex.get(fieldName);
    if (!field) return null;
    const extra: AutocompleteOption[] = [];
    let items: AutocompleteOption[] = [];
    if (field.type in OPTION_SET_TYPES) {
      items = filtered(await optionsFor(field.logicalName, field.type), typed);
    } else if (field.type === 'Boolean') {
      items = filtered([{ name: 'true', insert: 'true ' }, { name: 'false', insert: 'false ' }], typed);
    } else if (field.targets.length) {
      items = await searchRecords(field.targets, typed, isStale);
      if (isStale()) return null;
    } else if (field.type === 'String' || field.type === 'Memo') {
      if (!typed) extra.push({ name: "'text'", label: 'string value', insert: "'" });
      else if (typed.startsWith("'") && !/^'(?:[^']|'')*'$/.test(typed)) extra.push({ name: `${typed}'`, label: 'close string', insert: `${typed}' ` });
    } else if (field.type === 'DateTime') {
      const now = new Date();
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      items = filtered([
        { name: today.toISOString().replace('.000Z', 'Z'), label: 'today (UTC)', insert: `${today.toISOString().replace('.000Z', 'Z')} ` },
        { name: now.toISOString().replace(/\.\d+Z$/, 'Z'), label: 'now (UTC)', insert: `${now.toISOString().replace(/\.\d+Z$/, 'Z')} ` },
      ], typed);
    }
    if (!typed || 'null'.startsWith(typed.toLowerCase())) extra.push(nullItem);
    return { from, items: [...items, ...extra] };
  };

  return (before, isStale) => {
    const start = clauseStart(before);
    const clause = before.slice(start);
    let match: RegExpExecArray | null;

    // field name
    if ((match = /^\s*([\w.]*)$/.exec(clause))) {
      const typed = match[1] ?? '';
      const items = meta.fields.map(field => ({ ...field, insert: `${field.name} ` }));
      return { from: before.length - typed.length, items: filtered(items, typed) };
    }
    // operator
    if ((match = /^\s*([\w.]+)\s+(\w*)$/.exec(clause))) {
      const field = meta.fieldIndex.get(match[1] ?? '');
      const typed = match[2] ?? '';
      if (!field) return null;
      return { from: before.length - typed.length, items: operatorItems(field.type, typed) };
    }
    // value
    if ((match = /^\s*([\w.]+)\s+(eq|ne|gt|ge|lt|le)\s+('(?:[^']|'')*'?|[^\s']*)$/i.exec(clause))) {
      const typed = match[3] ?? '';
      return valueSuggestions(match[1] ?? '', typed, before.length - typed.length, isStale);
    }
    // and / or
    if ((match = /^\s*[\w.]+\s+(?:eq|ne|gt|ge|lt|le)\s+(?:'(?:[^']|'')*'|[^\s']+)\s+(\w*)$/i.exec(clause))) {
      const typed = match[1] ?? '';
      return { from: before.length - typed.length, items: filtered([{ name: 'and', insert: 'and ' }, { name: 'or', insert: 'or ' }], typed) };
    }
    return null;
  };
}
