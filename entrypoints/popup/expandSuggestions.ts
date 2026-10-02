import { listSuggestions, type AutocompleteOption, type SuggestionProvider, type Suggestions } from './Autocomplete';
import { loadEntityMetadata, type EntityMetadata, type MetadataGet } from './entityMetadata';
import { createFilterProvider, filtered } from './filterSuggestions';

/*
 * $expand=nav($select=a,b;$filter=...;$orderby=x desc;$top=5;$expand=nav2($select=c)),nav3(...)
 * Rules from the Dataverse "Join tables" docs:
 *  - single-valued (N:1) navigation properties accept $select and a nested $expand;
 *  - collection-valued (1:N, N:N) ones also accept $filter, $orderby and $top;
 *  - $orderby/$top cannot be combined with a nested $expand, and N:N cannot be expanded further;
 *  - a 1:N expanded inside another $expand only accepts $select and $filter.
 */

type Target = { meta: EntityMetadata; filter: SuggestionProvider };

/** Index of the last `separator` outside quotes and parentheses, plus the nesting depth at the end of the text. */
function scan(text: string, separator: string) {
  let inQuote = false;
  let depth = 0;
  let last = -1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'") inQuote = !inQuote;
    else if (inQuote) continue;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === separator && depth === 0) last = i;
  }
  return { last, depth };
}

function topLevelSegments(text: string, separator: string) {
  const segments: string[] = [];
  let rest = text;
  for (let at = scan(rest, separator).last; at >= 0; at = scan(rest, separator).last) {
    segments.unshift(rest.slice(at + 1));
    rest = rest.slice(0, at);
  }
  segments.unshift(rest);
  return segments;
}

const shift = (result: Suggestions | null, offset: number): Suggestions | null => (result ? { ...result, from: result.from + offset } : null);

function optionNames(nav: AutocompleteOption, nested: boolean, used: Set<string>) {
  const names = ['$select'];
  if (nav.kind === 'N:1') names.push('$expand');
  if (nav.kind === 'N:N') names.push('$filter', '$orderby', '$top');
  if (nav.kind === '1:N') {
    names.push('$filter');
    // A 1:N nested inside another $expand only takes $select and $filter.
    if (!nested) {
      if (!used.has('$expand')) names.push('$orderby', '$top');
      if (!used.has('$orderby') && !used.has('$top')) names.push('$expand');
    }
  }
  return names.filter(name => !used.has(name));
}

export function createExpandProvider(meta: EntityMetadata, get: MetadataGet, orgKey: string): SuggestionProvider {
  const targets = new Map<string, Promise<Target>>();
  const loadTarget = (logicalName: string) => {
    let pending = targets.get(logicalName);
    if (!pending) {
      pending = loadEntityMetadata(get, '', logicalName).then(loaded => ({ meta: loaded, filter: createFilterProvider(loaded, get, orgKey) }));
      targets.set(logicalName, pending);
      pending.catch(() => { if (targets.get(logicalName) === pending) targets.delete(logicalName); });
    }
    return pending;
  };

  const suggest = async (text: string, current: EntityMetadata, depth: number, parentKind: string | undefined, isStale: () => boolean): Promise<Suggestions | null> => {
    const itemStart = scan(text, ',').last + 1;
    const rawItem = text.slice(itemStart);
    const item = rawItem.trimStart();
    const base = itemStart + (rawItem.length - item.length);
    const paren = item.indexOf('(');

    // Navigation property name.
    if (paren < 0) {
      if (!/^\w*$/.test(item)) return null;
      const used = new Set(topLevelSegments(text.slice(0, itemStart), ',').map(segment => segment.trim().split('(')[0]));
      const items = current.navigations
        .filter(nav => !used.has(nav.name) && (depth === 0 || nav.kind !== 'N:N') && (parentKind !== '1:N' || nav.kind === 'N:1'))
        .map(nav => ({ ...nav, insert: `${nav.name}($select=` }));
      return { from: base, items: filtered(items, item) };
    }

    const nav = current.navigations.find(candidate => candidate.name === item.slice(0, paren).trim());
    if (!nav?.label) return null;
    const inner = item.slice(paren + 1);
    const innerBase = base + paren + 1;
    const innerScan = scan(inner, ';');
    if (innerScan.depth < 0) return null; // the parenthesis is already closed

    const optionStart = innerScan.last + 1;
    const rawOption = inner.slice(optionStart);
    const option = rawOption.trimStart();
    const optionBase = innerBase + optionStart + (rawOption.length - option.length);
    const used = new Set(topLevelSegments(inner.slice(0, optionStart), ';').map(segment => /^\s*(\$\w+)/.exec(segment)?.[1]?.toLowerCase() ?? ''));
    const equals = option.indexOf('=');

    if (equals < 0) {
      if (!/^\$?\w*$/.test(option)) return null;
      const items = optionNames(nav, depth > 0, used).map(name => ({ name, insert: `${name}=` }));
      return { from: optionBase, items: filtered(items, option) };
    }

    const name = option.slice(0, equals).trim().toLowerCase();
    const value = option.slice(equals + 1);
    const valueBase = optionBase + equals + 1;
    if (!['$select', '$orderby', '$filter', '$expand'].includes(name)) return null;
    const target = await loadTarget(nav.label).catch(() => undefined);
    if (!target || isStale()) return null;

    if (name === '$select') return shift(listSuggestions(value, value.length, target.meta.fields), valueBase);
    if (name === '$orderby') {
      const segment = topLevelSegments(value, ',').pop() ?? '';
      const direction = /^\s*[\w.]+\s+(\w*)$/.exec(segment);
      if (direction) {
        const typed = direction[1] ?? '';
        return { from: valueBase + value.length - typed.length, items: filtered([{ name: 'asc' }, { name: 'desc' }], typed) };
      }
      return shift(listSuggestions(value, value.length, target.meta.fields), valueBase);
    }
    if (name === '$filter') return shift(await target.filter(value, isStale), valueBase);
    return shift(await suggest(value, target.meta, depth + 1, nav.kind, isStale), valueBase);
  };

  return (before, isStale) => suggest(before, meta, 0, undefined, isStale);
}
