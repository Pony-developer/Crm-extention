import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Database, ExternalLink, RefreshCw, Search } from 'lucide-react';
import type { CrmContext, RelationshipsResult, ToolMessage } from '../../shared/types';

type Kind = '1:N' | 'N:1' | 'N:N';
export type Relationship = { id: string; schemaName: string; kind: Kind; direction: 'outgoing' | 'incoming' | 'bidirectional'; referencedEntity: string; referencingEntity: string; relatedEntity: string };
type CacheEntry = { savedAt: number; relationships: Relationship[] };
type Branch = { entity: string; depth: number; via?: Relationship };

const CACHE_VERSION = 1;
const CACHE_TTL = 15 * 60 * 1000;
const cacheKey = (orgUrl: string, entity: string) => `relationship-metadata:v${CACHE_VERSION}:${orgUrl.toLowerCase()}:${entity.toLowerCase()}`;

async function loadRelationships(orgUrl: string, entity: string, force = false): Promise<Relationship[]> {
  const key = cacheKey(orgUrl, entity);
  if (!force) {
    const stored = (await browser.storage.local.get(key))[key] as CacheEntry | undefined;
    if (stored && Date.now() - stored.savedAt < CACHE_TTL) return stored.relationships;
  }
  const result = await browser.runtime.sendMessage({ type: 'GET_RELATIONSHIPS', request: { logicalName: entity } } satisfies ToolMessage) as RelationshipsResult;
  if (!result?.ok) {
    const error = result?.error ?? { message: 'Dynamics did not return relationship metadata. Verify that the active tab belongs to this organization.' };
    if (error.status === 401 || error.status === 403) throw new Error(`Insufficient privileges (${error.status}). Read EntityDefinition and relationship metadata privileges are required.`);
    throw new Error(`${error.message}${error.status ? ` (${error.status})` : ''}`);
  }
  const map = new Map<string, Relationship>();
  const add = (raw: { MetadataId?: string; SchemaName?: string }, kind: Kind, direction: Relationship['direction'], referenced: string, referencing: string, related: string) => {
    const id = raw.MetadataId || `${kind}:${raw.SchemaName}:${related}`;
    map.set(id, { id, schemaName: raw.SchemaName || '(unnamed relationship)', kind, direction, referencedEntity: referenced, referencingEntity: referencing, relatedEntity: related });
  };
  for (const raw of result.data.oneToMany) add(raw, '1:N', 'outgoing', raw.ReferencedEntity || entity, raw.ReferencingEntity || 'unknown', raw.ReferencingEntity || 'unknown');
  for (const raw of result.data.manyToOne) add(raw, 'N:1', 'incoming', raw.ReferencedEntity || 'unknown', raw.ReferencingEntity || entity, raw.ReferencedEntity || 'unknown');
  for (const raw of result.data.manyToMany) {
    const related = raw.Entity1LogicalName === entity ? raw.Entity2LogicalName : raw.Entity1LogicalName;
    add(raw, 'N:N', 'bidirectional', raw.Entity1LogicalName || entity, raw.Entity2LogicalName || 'unknown', related || 'unknown');
  }
  const relationships = [...map.values()].sort((a, b) => a.relatedEntity.localeCompare(b.relatedEntity) || a.schemaName.localeCompare(b.schemaName));
  await browser.storage.local.set({ [key]: { savedAt: Date.now(), relationships } satisfies CacheEntry });
  return relationships;
}

export function RelationshipsView({ context, onOpenMetadata }: { context: CrmContext; onOpenMetadata: (entity: string) => void }) {
  const entity = context.entityName;
  const orgUrl = context.orgUrl;
  const [root, setRoot] = useState<Relationship[] | null>(null);
  const [children, setChildren] = useState<Record<string, Relationship[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [depth, setDepth] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = async (force = false) => {
    if (!entity || !orgUrl) return;
    setLoading(true); setError('');
    try { setRoot(await loadRelationships(orgUrl, entity, force)); if (force) { setChildren({}); setExpanded({}); } }
    catch (reason) { setRoot(null); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { setRoot(null); setChildren({}); setExpanded({}); void refresh(); }, [entity, orgUrl]);
  const query = filter.trim().toLowerCase();
  const matches = (relationship: Relationship) => !query || [relationship.schemaName, relationship.relatedEntity, relationship.referencedEntity, relationship.referencingEntity, relationship.kind, relationship.direction].some(value => value.toLowerCase().includes(query));
  const visibleRoot = useMemo(() => (root || []).filter(matches), [root, query]);
  const toggle = async (branch: Branch) => {
    const key = `${branch.depth}:${branch.entity}`;
    if (expanded[key]) { setExpanded(value => ({ ...value, [key]: false })); return; }
    setExpanded(value => ({ ...value, [key]: true }));
    if (branch.depth >= depth || children[key] || !orgUrl) return;
    try { setChildren(value => ({ ...value, [key]: [] })); const data = await loadRelationships(orgUrl, branch.entity); setChildren(value => ({ ...value, [key]: data })); }
    catch (reason) { setExpanded(value => ({ ...value, [key]: false })); setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const renderBranch = (branch: Branch, relationships: Relationship[]): React.ReactNode => {
    const key = `${branch.depth}:${branch.entity}`; const open = expanded[key];
    return <div className="graph-branch" key={key}>
      {branch.via && <button className="graph-node" onClick={() => void toggle(branch)} title="Expand this table">
        <span className="tree-lines" />{branch.depth < depth ? (open ? <ChevronDown/> : <ChevronRight/>) : <span className="chevron-space" />}
        <Database/><b>{branch.entity}</b><em>{branch.via.kind}</em>
      </button>}
      {(!branch.via || open) && <div className={branch.via ? 'graph-children' : ''}>{relationships.filter(matches).map(rel => {
        const childKey = `${branch.depth + 1}:${rel.relatedEntity}`;
        return <div className="relationship-row" key={`${key}:${rel.id}`}>
          <button className="relationship-info" onClick={() => onOpenMetadata(rel.relatedEntity)} title="Open table metadata">
            <span className={`relation-kind kind-${rel.kind.replace(':', '')}`}>{rel.kind}</span><span><b>{rel.schemaName}</b><small>{rel.direction} · {rel.referencedEntity} → {rel.referencingEntity}</small></span><ExternalLink/>
          </button>
          {branch.depth < depth && renderBranch({ entity: rel.relatedEntity, depth: branch.depth + 1, via: rel }, children[childKey] || [])}
        </div>;
      })}</div>}
    </div>;
  };
  if (!entity || !orgUrl) return <div className="notice"><AlertTriangle/> Open a Dynamics record so its organization and entity logical name can be detected.</div>;
  return <>
    <div className="title"><div><h2>Relationship map</h2><p>{entity} · EntityDefinitions navigation properties</p></div><button className="sub" onClick={() => void refresh(true)} disabled={loading}><RefreshCw className={loading ? 'spin' : ''}/>{loading ? 'Loading' : 'Refresh'}</button></div>
    <div className="relationship-controls"><div><Search/><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter name or table…"/></div><label>Depth<select value={depth} onChange={event => { setDepth(Number(event.target.value)); setExpanded({}); }}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label></div>
    {error && <div className="notice error"><AlertTriangle/>{error}<button onClick={() => void refresh()}>Retry</button></div>}
    {loading && root === null && <div className="graph-skeleton">Loading relationship metadata…</div>}
    {!loading && !error && root?.length === 0 && <div className="notice">Metadata loaded successfully. This table has no relationships.</div>}
    {!loading && !error && root && root.length > 0 && visibleRoot.length === 0 && <div className="notice">No relationships match “{filter}”. Clear the filter to see all {root.length} relationships.</div>}
    {root && visibleRoot.length > 0 && <div className="relationship-graph"><div className="root-node"><Database/><b>{entity}</b><span>{root.length} relationships</span></div>{renderBranch({ entity, depth: 0 }, visibleRoot)}</div>}
  </>;
}
