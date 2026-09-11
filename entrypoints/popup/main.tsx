import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Braces, ChevronDown, CircleDot, Clock3, Code2, Command, Copy, Database, ExternalLink, FileSearch, GitFork, Moon, Network, Pencil, Play, RefreshCw, Search, Settings, Sparkles, Sun, Terminal, Trash2, X, Zap } from 'lucide-react';
import type { CrmContext, SavedEnvironment, ToolMessage } from '../../shared/types';
import './style.css';

type View = 'console' | 'traces' | 'tools' | 'settings';
type TraceLog = { plugintracelogid: string; typename?: string; messageblock?: string; exceptiondetails?: string; performanceexecutionduration?: number; createdon?: string; mode?: number };
type EnvironmentDraft = Omit<SavedEnvironment, 'id'>;
type NavigationPrompt = { kind: 'auth' | 'missing' | 'error'; environment: SavedEnvironment; target: string; tableTarget?: string; message: string };

const tabs = [{ id: 'console', label: 'API Console', icon: Terminal }, { id: 'traces', label: 'Trace Logs', icon: FileSearch }, { id: 'tools', label: 'Tools', icon: Sparkles }] as const;
const kinds: SavedEnvironment['kind'][] = ['Dev', 'Test', 'Prod'];
const defaultColors: Record<SavedEnvironment['kind'], string> = { Dev: '#43db9b', Test: '#f8bb54', Prod: '#fa6673' };
const emptyDraft: EnvironmentDraft = { name: '', url: '', kind: 'Dev', color: defaultColors.Dev };

function normalizeEnvironmentUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  const parsed = new URL(withProtocol);
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || (hostname !== 'dynamics.com' && !hostname.endsWith('.dynamics.com'))) {
    throw new Error('Use an HTTPS URL on the dynamics.com domain.');
  }
  return `https://${hostname}`;
}

function odataString(value: string) { return value.replace(/'/g, "''"); }
function cleanGuid(value: string) { return value.replace(/[{}]/g, '').toLowerCase(); }

function App() {
  const [view, setView] = useState<View>('console');
  const [ctx, setCtx] = useState<CrmContext>({ connected: false });
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/api/data/v9.2/accounts?$select=name,revenue&$top=10');
  const [response, setResponse] = useState('');
  const [running, setRunning] = useState(false);
  const [dark, setDark] = useState(false);
  const [copied, setCopied] = useState(false);
  const [logs, setLogs] = useState<TraceLog[]>([]);
  const [traceError, setTraceError] = useState('');
  const [traceLoading, setTraceLoading] = useState(false);
  const [environments, setEnvironments] = useState<SavedEnvironment[]>([]);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EnvironmentDraft>(emptyDraft);
  const [environmentError, setEnvironmentError] = useState('');
  const [navigationPrompt, setNavigationPrompt] = useState<NavigationPrompt | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLElement>(null);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_ACTIVE_CONTEXT' } satisfies ToolMessage).then(value => value && setCtx(value)).catch(() => undefined);
    browser.storage.local.get(['themeEnabled', 'environments']).then(value => {
      setDark(Boolean(value.themeEnabled));
      setEnvironments((value.environments as SavedEnvironment[]) || []);
    });
  }, []);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!dropdownRef.current?.contains(event.target as Node)) setEnvironmentOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setEnvironmentOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);

  const currentEnvironment = environments.find(environment => {
    try { return ctx.orgUrl && normalizeEnvironmentUrl(environment.url) === normalizeEnvironmentUrl(ctx.orgUrl); } catch { return false; }
  });
  const persistEnvironments = async (next: SavedEnvironment[]) => { setEnvironments(next); await browser.storage.local.set({ environments: next }); };
  const appParams = (url: URL) => {
    if (ctx.appId) url.searchParams.set('appid', ctx.appId);
    else if (ctx.appUniqueName) url.searchParams.set('appname', ctx.appUniqueName);
  };
  const destination = (environment: SavedEnvironment, pageType?: 'entityrecord' | 'entitylist') => {
    const url = new URL('/main.aspx', environment.url);
    appParams(url);
    if (ctx.entityName) url.searchParams.set('etn', ctx.entityName);
    if (pageType) url.searchParams.set('pagetype', pageType);
    if (pageType === 'entityrecord' && ctx.recordId) url.searchParams.set('id', cleanGuid(ctx.recordId));
    return url.toString();
  };
  const openDestination = async (target: string) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) await browser.tabs.update(tab.id, { url: target });
    setNavigationPrompt(null);
  };

  const switchEnvironment = async (environment: SavedEnvironment) => {
    setEnvironmentOpen(false); setSwitchingId(environment.id);
    const orgTarget = destination(environment);
    if (!ctx.entityName || !ctx.recordId) { await openDestination(orgTarget); setSwitchingId(null); return; }
    try {
      const metadataUrl = `${environment.url}/api/data/v9.2/EntityDefinitions(LogicalName='${odataString(ctx.entityName)}')?$select=EntitySetName,PrimaryIdAttribute`;
      const metadataResponse = await fetch(metadataUrl, { credentials: 'include', headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } });
      if (metadataResponse.status === 401 || metadataResponse.status === 403) {
        setNavigationPrompt({ kind: 'auth', environment, target: orgTarget, message: `Sign in to ${environment.name} before the record can be checked.` }); return;
      }
      if (!metadataResponse.ok) throw new Error(`Metadata request failed (${metadataResponse.status}).`);
      const metadata = await metadataResponse.json() as { EntitySetName?: string; PrimaryIdAttribute?: string };
      if (!metadata.EntitySetName || !metadata.PrimaryIdAttribute) throw new Error('The table metadata does not contain an entity set name.');
      const recordUrl = `${environment.url}/api/data/v9.2/${encodeURIComponent(metadata.EntitySetName)}(${cleanGuid(ctx.recordId)})?$select=${encodeURIComponent(metadata.PrimaryIdAttribute)}`;
      const recordResponse = await fetch(recordUrl, { credentials: 'include', headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } });
      if (recordResponse.status === 401 || recordResponse.status === 403) {
        setNavigationPrompt({ kind: 'auth', environment, target: orgTarget, message: `Sign in to ${environment.name} before the record can be checked.` }); return;
      }
      if (recordResponse.status === 404) {
        setNavigationPrompt({ kind: 'missing', environment, target: destination(environment, 'entityrecord'), tableTarget: destination(environment, 'entitylist'), message: 'This record does not exist in the target environment.' }); return;
      }
      if (!recordResponse.ok) throw new Error(`Record check failed (${recordResponse.status}).`);
      await openDestination(destination(environment, 'entityrecord'));
    } catch (error) {
      setNavigationPrompt({ kind: 'error', environment, target: orgTarget, message: error instanceof Error ? error.message : String(error) });
    } finally { setSwitchingId(null); }
  };

  const startCreate = () => { setEditingId('new'); setDraft(emptyDraft); setEnvironmentError(''); };
  const startEdit = (environment: SavedEnvironment) => { setEditingId(environment.id); setDraft({ name: environment.name, url: environment.url, kind: environment.kind, color: environment.color }); setEnvironmentError(''); };
  const saveEnvironment = async (event: React.FormEvent) => {
    event.preventDefault(); setEnvironmentError('');
    try {
      const url = normalizeEnvironmentUrl(draft.url);
      if (!draft.name.trim()) throw new Error('Enter an environment name.');
      if (environments.some(environment => environment.id !== editingId && normalizeEnvironmentUrl(environment.url) === url)) throw new Error('This environment URL is already saved.');
      const saved: SavedEnvironment = { ...draft, id: editingId === 'new' ? crypto.randomUUID() : editingId!, name: draft.name.trim(), url };
      await persistEnvironments(editingId === 'new' ? [...environments, saved] : environments.map(environment => environment.id === editingId ? saved : environment));
      setEditingId(null);
    } catch (error) { setEnvironmentError(error instanceof Error ? error.message : 'Enter a valid environment URL.'); }
  };
  const deleteEnvironment = async (environment: SavedEnvironment) => {
    if (!window.confirm(`Delete “${environment.name}”?`)) return;
    await persistEnvironments(environments.filter(item => item.id !== environment.id));
    if (editingId === environment.id) setEditingId(null);
  };

  const run = async () => { setRunning(true); setResponse(''); try { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw Error('No active Dynamics tab'); const result = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args: [method, path], func: async (m, p) => { const r = await fetch(p, { method: m, headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } }); return { status: r.status, body: await r.text() }; } }); const out = result[0]?.result; let body = out?.body || '{}'; try { body = JSON.stringify(JSON.parse(body), null, 2); } catch {} setResponse(`HTTP ${out?.status}\n\n${body}`); } catch (error) { setResponse(`Request failed\n${String(error)}`); } finally { setRunning(false); } };
  const copy = () => { navigator.clipboard.writeText([ctx.recordId, ctx.entityName, ctx.formName].filter(Boolean).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  const theme = async () => { const next = !dark; setDark(next); await browser.storage.local.set({ themeEnabled: next }); await browser.runtime.sendMessage({ type: 'SET_THEME', enabled: next } satisfies ToolMessage).catch(() => undefined); };
  const loadTraces = async () => { setTraceLoading(true); setTraceError(''); try { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw Error('No active Dynamics tab'); const request = '/api/data/v9.2/plugintracelogs?$select=plugintracelogid,typename,messageblock,exceptiondetails,performanceexecutionduration,createdon,mode&$orderby=createdon desc&$top=25'; const result = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args: [request], func: async p => { const r = await fetch(p, { headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } }); if (!r.ok) throw Error(`${r.status} ${r.statusText}`); return r.json(); } }); setLogs(result[0]?.result?.value || []); } catch (error) { setTraceError(String(error)); } finally { setTraceLoading(false); } };
  useEffect(() => { if (view === 'traces' && !logs.length && !traceLoading) void loadTraces(); }, [view]);

  return <div className="app"><header><div className="brand"><div className="logo"><Braces /></div><div><b>Dynamics Toolkit</b><span>Developer companion</span></div></div><div><button className="icon" aria-label="Toggle theme" onClick={theme}>{dark ? <Moon /> : <Sun />}</button><button className="icon" aria-label="Open settings" onClick={() => setView('settings')}><Settings /></button></div></header>
    <section className="environment" ref={dropdownRef}><button className="environment-trigger" type="button" aria-haspopup="listbox" aria-expanded={environmentOpen} onClick={() => setEnvironmentOpen(open => !open)}><div className="env"><i style={{ background: currentEnvironment?.color }} /><div><span>CURRENT ENVIRONMENT</span><b>{currentEnvironment?.name || ctx.orgName || 'Dynamics environment'}</b></div><ChevronDown /></div><em>{currentEnvironment?.kind || 'CURRENT'}</em></button>{environmentOpen && <div className="environment-menu" role="listbox" aria-label="Saved environments">{environments.map(environment => <button role="option" aria-selected={environment.id === currentEnvironment?.id} key={environment.id} onClick={() => void switchEnvironment(environment)} disabled={switchingId === environment.id}><i style={{ background: environment.color }} /><span><b>{environment.name}</b><small>{new URL(environment.url).hostname}</small></span><em>{switchingId === environment.id ? 'Checking…' : environment.kind}</em></button>)}{!environments.length && <p>No saved environments.</p>}<button className="manage-environments" onClick={() => { setView('settings'); setEnvironmentOpen(false); }}><Settings /> Manage environments</button></div>}</section>
    <section className="record"><div className="record-icon"><Database /></div><div className="record-text"><span>{ctx.entityName || 'account'}</span><b>{ctx.recordName || 'No active record'}</b><small>{ctx.recordId || 'Open a record to capture its context'}</small></div><button onClick={copy}><Copy />{copied ? 'Copied' : 'Copy context'}</button></section>
    <nav>{tabs.map(tab => <button key={tab.id} className={view === tab.id ? 'active' : ''} onClick={() => setView(tab.id)}><tab.icon />{tab.label}</button>)}</nav><main>
      {view === 'console' && <><Title title="Web API Console" text="Run requests against the current organization"><button className="sub"><Clock3 />History</button></Title><div className="request"><select value={method} onChange={event => setMethod(event.target.value)}><option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option></select><input value={path} onChange={event => setPath(event.target.value)} /><button onClick={run} disabled={running}><Play />{running ? 'Running' : 'Run'}</button></div><div className="builder"><div><label>QUERY BUILDER</label><button><Code2 />FetchXML</button></div><section><button><b>$select</b><span>name, revenue</span></button><button><b>$filter</b><span>Add filter</span></button><button><b>$expand</b><span>Add relation</span></button></section></div><div className="response"><div><label>RESPONSE</label>{response && <em>RESULT</em>}</div><pre>{response || '{\n  "ready": true,\n  "message": "Run a request to see results"\n}'}</pre></div></>}
      {view === 'traces' && <><Title title="Plugin Trace Logs" text="Latest executions from this organization"><button className="sub" onClick={loadTraces} disabled={traceLoading}><RefreshCw className={traceLoading ? 'spin' : ''} />{traceLoading ? 'Loading' : 'Refresh'}</button></Title><div className="filters"><Search /><input placeholder="Search message or plugin…" /><button>Latest 25 <ChevronDown /></button></div>{traceError && <div className="notice error">{traceError}</div>}{!traceLoading && !traceError && !logs.length && <div className="notice">No plugin trace logs found. Check tracing settings and privileges.</div>}<div className="logs">{logs.map(log => { const failed = Boolean(log.exceptiondetails); return <article key={log.plugintracelogid} title={log.exceptiondetails || log.messageblock}><i className={failed ? 'exception' : 'success'} /><div><span>{failed ? 'Exception' : 'Success'} · {log.createdon ? new Date(log.createdon).toLocaleString() : 'Unknown time'}</span><b>{log.typename || 'Plugin execution'}</b></div><small>{log.performanceexecutionduration ?? 0} ms</small><ExternalLink /></article>; })}</div></>}
      {view === 'tools' && <><Title title="Developer Tools" text="Inspect, debug, and navigate faster" /><div className="tools">{[[Command, 'Command palette', 'Jump to tables, views, forms and flows', '⌘ ⇧ K'], [CircleDot, 'Dirty fields', 'Highlight values changed on this form', 'Active'], [Activity, 'Form performance', 'Resources and execution timeline', '1.24 s'], [Network, 'Relationship map', 'Explore N:N and 1:N relationships', 'Open'], [GitFork, 'Repro recorder', 'Capture annotated steps for a ticket', 'Record'], [Zap, 'Metadata inspector', 'Hover fields for schema details', 'Active']].map(([Icon, title, text, status]: any) => <button key={title}><div><Icon /></div><section><b>{title}</b><span>{text}</span></section><em>{status}</em></button>)}</div></>}
      {view === 'settings' && <><Title title="Settings" text="Customize your Toolkit experience" /><div className="settings"><h3>ENVIRONMENTS</h3>{environments.map(environment => <div className="setting" key={environment.id}><button className="setting-main" onClick={() => void switchEnvironment(environment)}><i style={{ background: environment.color }} /><span><b>{environment.name}</b><small>{new URL(environment.url).hostname}</small></span><em>{environment.kind}</em></button><button className="setting-action" aria-label={`Edit ${environment.name}`} onClick={() => startEdit(environment)}><Pencil /></button><button className="setting-action danger" aria-label={`Delete ${environment.name}`} onClick={() => void deleteEnvironment(environment)}><Trash2 /></button></div>)}{!environments.length && <div className="notice">No environments saved yet.</div>}<button className="add" onClick={startCreate}>+ Add environment</button>{editingId && <form className="environment-form" onSubmit={saveEnvironment}><div className="form-heading"><b>{editingId === 'new' ? 'Add environment' : 'Edit environment'}</b><button type="button" aria-label="Close editor" onClick={() => setEditingId(null)}><X /></button></div><label>Name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="Contoso Development" autoFocus /></label><label>URL<input value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} placeholder="org.crm.dynamics.com" /></label><div className="form-row"><label>Kind<select value={draft.kind} onChange={event => { const kind = event.target.value as SavedEnvironment['kind']; setDraft({ ...draft, kind, color: defaultColors[kind] }); }}>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label><label>Color<input className="color" type="color" value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value })} /></label></div>{environmentError && <div className="form-error" role="alert">{environmentError}</div>}<div className="form-actions"><button type="button" onClick={() => setEditingId(null)}>Cancel</button><button type="submit">Save environment</button></div></form>}</div></>}
    </main><footer><span><CircleDot />{ctx.connected ? 'Connected to Dynamics 365' : 'Open Dynamics 365 to connect'}</span><span>v0.1.0</span></footer>
    {navigationPrompt && <div className="modal-backdrop" role="presentation"><div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="navigation-title"><div className="form-heading"><b id="navigation-title">{navigationPrompt.kind === 'auth' ? 'Sign-in required' : navigationPrompt.kind === 'missing' ? 'Record not found' : 'Could not verify record'}</b><button aria-label="Close" onClick={() => setNavigationPrompt(null)}><X /></button></div><p>{navigationPrompt.message}</p><div className="form-actions"><button onClick={() => setNavigationPrompt(null)}>Cancel</button>{navigationPrompt.kind === 'missing' && <button onClick={() => void openDestination(navigationPrompt.tableTarget!)}>Open table</button>}{navigationPrompt.kind === 'auth' && <button onClick={() => void openDestination(navigationPrompt.target)}>Open org to sign in</button>}{navigationPrompt.kind === 'error' && <button onClick={() => void openDestination(navigationPrompt.target)}>Open org anyway</button>}</div></div></div>}
  </div>;
}
function Title({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) { return <div className="title"><div><h2>{title}</h2><p>{text}</p></div>{children}</div>; }
createRoot(document.getElementById('root')!).render(<App />);
