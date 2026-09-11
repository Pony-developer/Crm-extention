import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Braces, ChevronDown, ChevronRight, CircleDot, Clock3, Code2, Command, Copy, Database, ExternalLink, FileSearch, GitFork, Moon, Network, Play, RefreshCw, Search, Settings, Sparkles, Sun, Terminal, Zap } from 'lucide-react';
import type { CrmContext, SavedEnvironment, ToolMessage } from '../../shared/types';
import './style.css';

type View = 'console' | 'traces' | 'tools' | 'settings';
type OutcomeFilter = 'all' | 'success' | 'exception';
type ModeFilter = 'all' | 'sync' | 'async';
type TimeRange = 'all' | '1h' | '6h' | '24h' | '7d';
type TraceLog = {
  plugintracelogid: string;
  typename?: string;
  messagename?: string;
  messageblock?: string;
  exceptiondetails?: string;
  performanceconstructorduration?: number;
  performanceconstructorstarttime?: string;
  performanceexecutionduration?: number;
  performanceexecutionstarttime?: string;
  correlationid?: string;
  operationtype?: number;
  createdon?: string;
  mode?: number;
  depth?: number;
  primaryentity?: string;
};

const tabs = [{ id: 'console', label: 'API Console', icon: Terminal }, { id: 'traces', label: 'Trace Logs', icon: FileSearch }, { id: 'tools', label: 'Tools', icon: Sparkles }] as const;
const traceColumns = ['plugintracelogid', 'typename', 'messagename', 'messageblock', 'exceptiondetails', 'performanceconstructorduration', 'performanceconstructorstarttime', 'performanceexecutionduration', 'performanceexecutionstarttime', 'correlationid', 'operationtype', 'createdon', 'mode', 'depth', 'primaryentity'].join(',');
const ranges: Record<Exclude<TimeRange, 'all'>, number> = { '1h': 1, '6h': 6, '24h': 24, '7d': 168 };

function App() {
  const [view, setView] = useState<View>('console'), [ctx, setCtx] = useState<CrmContext>({ connected: false }), [method, setMethod] = useState('GET'), [path, setPath] = useState('/api/data/v9.2/accounts?$select=name,revenue&$top=10'), [response, setResponse] = useState(''), [running, setRunning] = useState(false), [dark, setDark] = useState(false), [copied, setCopied] = useState(false), [logs, setLogs] = useState<TraceLog[]>([]), [traceError, setTraceError] = useState(''), [traceLoading, setTraceLoading] = useState(false), [environments, setEnvironments] = useState<SavedEnvironment[]>([]);
  const [query, setQuery] = useState(''), [outcome, setOutcome] = useState<OutcomeFilter>('all'), [traceMode, setTraceMode] = useState<ModeFilter>('all'), [timeRange, setTimeRange] = useState<TimeRange>('24h'), [traceCount, setTraceCount] = useState(25), [expanded, setExpanded] = useState<string | null>(null), [traceSetting, setTraceSetting] = useState<number | null>(null), [copiedTrace, setCopiedTrace] = useState<string | null>(null), [dynamicsOrigin, setDynamicsOrigin] = useState('');

  useEffect(() => { browser.runtime.sendMessage({ type: 'GET_ACTIVE_CONTEXT' } satisfies ToolMessage).then(v => v && setCtx(v)).catch(() => {}); browser.storage.local.get(['themeEnabled', 'environments']).then(x => { setDark(Boolean(x.themeEnabled)); setEnvironments((x.environments as SavedEnvironment[]) || []); }); }, []);
  const run = async () => { setRunning(true); setResponse(''); try { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw Error('No active Dynamics tab'); const result = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args: [method, path], func: async (m, p) => { const r = await fetch(p, { method: m, headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } }); return { status: r.status, body: await r.text() }; } }); const out = result[0]?.result; let body = out?.body || '{}'; try { body = JSON.stringify(JSON.parse(body), null, 2); } catch {} setResponse(`HTTP ${out?.status}\n\n${body}`); } catch (e) { setResponse(`Request failed\n${String(e)}`); } finally { setRunning(false); } };
  const copy = () => { navigator.clipboard.writeText([ctx.recordId, ctx.entityName, ctx.formName].filter(Boolean).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  const theme = async () => { const next = !dark; setDark(next); await browser.storage.local.set({ themeEnabled: next }); await browser.runtime.sendMessage({ type: 'SET_THEME', enabled: next } satisfies ToolMessage).catch(() => {}); };

  const loadTraces = async () => {
    setTraceLoading(true); setTraceError(''); setTraceSetting(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw Error('Open a Dynamics 365 tab to load trace logs.');
      const cutoff = timeRange === 'all' ? '' : `&$filter=createdon ge ${new Date(Date.now() - ranges[timeRange] * 3_600_000).toISOString()}`;
      const request = `/api/data/v9.2/plugintracelogs?$select=${traceColumns}&$orderby=createdon desc&$top=${traceCount}${cutoff}`;
      const settingsRequest = '/api/data/v9.2/organizations?$select=plugintracelogsetting&$top=1';
      const result = await browser.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args: [request, settingsRequest], func: async (traceUrl, orgUrl) => {
        const headers = { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' };
        const traces = await fetch(traceUrl, { headers });
        const body = await traces.text();
        let setting: number | null = null;
        try { const org = await fetch(orgUrl, { headers }); if (org.ok) setting = (await org.json()).value?.[0]?.plugintracelogsetting ?? null; } catch {}
        return { ok: traces.ok, status: traces.status, statusText: traces.statusText, body, setting, origin: location.origin };
      } });
      const output = result[0]?.result;
      if (!output) throw Error('Dynamics did not return a response.');
      if (!output.ok) {
        if (output.status === 401 || output.status === 403) throw Error('Access denied: your security role cannot read Plugin Trace Logs.');
        throw Error(`Could not load Plugin Trace Logs (${output.status} ${output.statusText}).`);
      }
      const data = JSON.parse(output.body) as { value?: TraceLog[] };
      setLogs(data.value || []); setTraceSetting(output.setting); setDynamicsOrigin(output.origin);
    } catch (e) { setLogs([]); setTraceError(e instanceof Error ? e.message : String(e)); } finally { setTraceLoading(false); }
  };

  useEffect(() => { if (view === 'traces') void loadTraces(); }, [view, traceCount, timeRange]);
  const filteredLogs = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return logs.filter(log => {
      const failed = Boolean(log.exceptiondetails);
      const matchesText = !needle || [log.typename, log.messagename, log.messageblock, log.exceptiondetails].some(value => value?.toLocaleLowerCase().includes(needle));
      const matchesOutcome = outcome === 'all' || (outcome === 'exception' ? failed : !failed);
      const matchesMode = traceMode === 'all' || (traceMode === 'async' ? log.mode === 1 : log.mode !== 1);
      return matchesText && matchesOutcome && matchesMode;
    });
  }, [logs, outcome, query, traceMode]);
  const copyTrace = async (log: TraceLog) => { await navigator.clipboard.writeText(formatTrace(log)); setCopiedTrace(log.plugintracelogid); setTimeout(() => setCopiedTrace(null), 1200); };
  const openTrace = (log: TraceLog) => { if (!dynamicsOrigin) return; const url = new URL('/main.aspx', dynamicsOrigin); url.searchParams.set('pagetype', 'entityrecord'); url.searchParams.set('etn', 'plugintracelog'); url.searchParams.set('id', log.plugintracelogid); void browser.tabs.create({ url: url.toString() }); };

  const addEnvironment = async () => { const url = window.prompt('Dynamics environment URL (https://org.crm.dynamics.com)'); if (!url) return; try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.dynamics.com')) throw Error(); const name = window.prompt('Environment name', parsed.hostname.split('.')[0]) || parsed.hostname; const next = [...environments, { id: crypto.randomUUID(), name, url: parsed.origin, kind: 'Dev' as const, color: '#43db9b' }]; setEnvironments(next); await browser.storage.local.set({ environments: next }); } catch { window.alert('Enter a valid HTTPS dynamics.com URL'); } };
  const switchEnvironment = async (env: SavedEnvironment) => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) return; const target = new URL('/main.aspx', env.url); if (ctx.entityName) target.searchParams.set('etn', ctx.entityName); if (ctx.recordId) { target.searchParams.set('pagetype', 'entityrecord'); target.searchParams.set('id', ctx.recordId); } await browser.tabs.update(tab.id, { url: target.toString() }); };

  return <div className="app"><header><div className="brand"><div className="logo"><Braces /></div><div><b>Dynamics Toolkit</b><span>Developer companion</span></div></div><div><button className="icon" onClick={theme}>{dark ? <Moon /> : <Sun />}</button><button className="icon" onClick={() => setView('settings')}><Settings /></button></div></header>
    <section className="environment"><div className="env"><i /><div><span>CURRENT ENVIRONMENT</span><b>{ctx.orgName || 'Contoso Development'}</b></div><ChevronDown /></div><em>DEV</em></section>
    <section className="record"><div className="record-icon"><Database /></div><div className="record-text"><span>{ctx.entityName || 'account'}</span><b>{ctx.recordName || 'Northwind Traders'}</b><small>{ctx.recordId || '8d3f4c21-93b6-ee11-a569-000d3a8b1c2d'}</small></div><button onClick={copy}><Copy />{copied ? 'Copied' : 'Copy context'}</button></section>
    <nav>{tabs.map(t => <button key={t.id} className={view === t.id ? 'active' : ''} onClick={() => setView(t.id)}><t.icon />{t.label}</button>)}</nav><main>
      {view === 'console' && <><Title title="Web API Console" text="Run requests against the current organization"><button className="sub"><Clock3 />History</button></Title><div className="request"><select value={method} onChange={e => setMethod(e.target.value)}><option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option></select><input value={path} onChange={e => setPath(e.target.value)} /><button onClick={run} disabled={running}><Play />{running ? 'Running' : 'Run'}</button></div><div className="builder"><div><label>QUERY BUILDER</label><button><Code2 />FetchXML</button></div><section><button><b>$select</b><span>name, revenue</span></button><button><b>$filter</b><span>Add filter</span></button><button><b>$expand</b><span>Add relation</span></button></section></div><div className="response"><div><label>RESPONSE</label>{response && <em>200 OK</em>}</div><pre>{response || '{\n  "ready": true,\n  "message": "Run a request to see results"\n}'}</pre></div></>}
      {view === 'traces' && <><Title title="Plugin Trace Logs" text="Executions from this organization"><button className="sub" onClick={loadTraces} disabled={traceLoading}><RefreshCw className={traceLoading ? 'spin' : ''} />{traceLoading ? 'Loading' : 'Refresh'}</button></Title>
        <div className="trace-toolbar"><div className="trace-search"><Search /><input aria-label="Search traces" placeholder="Plugin, type, message, exception…" value={query} onChange={e => setQuery(e.target.value)} /></div><select aria-label="Record count" value={traceCount} onChange={e => setTraceCount(Number(e.target.value))}>{[10, 25, 50, 100].map(n => <option key={n} value={n}>Latest {n}</option>)}</select></div>
        <div className="trace-filters"><select aria-label="Outcome" value={outcome} onChange={e => setOutcome(e.target.value as OutcomeFilter)}><option value="all">All outcomes</option><option value="success">Success</option><option value="exception">Exception</option></select><select aria-label="Execution mode" value={traceMode} onChange={e => setTraceMode(e.target.value as ModeFilter)}><option value="all">Sync + async</option><option value="sync">Synchronous</option><option value="async">Asynchronous</option></select><select aria-label="Time range" value={timeRange} onChange={e => setTimeRange(e.target.value as TimeRange)}><option value="1h">Last hour</option><option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="all">All time</option></select></div>
        {traceError && <div className="notice error">{traceError}</div>}
        {!traceLoading && !traceError && !logs.length && traceSetting === 0 && <div className="notice warning-notice">Plugin tracing is disabled for this organization. Enable it in System Settings to collect traces.</div>}
        {!traceLoading && !traceError && !logs.length && traceSetting !== 0 && <div className="notice">No plugin trace logs were found for the selected time range.</div>}
        {!traceLoading && !traceError && logs.length > 0 && !filteredLogs.length && <div className="notice">No loaded traces match these search and filter settings.</div>}
        <div className="logs">{filteredLogs.map(log => <TraceCard key={log.plugintracelogid} log={log} open={expanded === log.plugintracelogid} copied={copiedTrace === log.plugintracelogid} onToggle={() => setExpanded(expanded === log.plugintracelogid ? null : log.plugintracelogid)} onCopy={() => void copyTrace(log)} onOpen={() => openTrace(log)} />)}</div></>}
      {view === 'tools' && <><Title title="Developer Tools" text="Inspect, debug, and navigate faster" /><div className="tools">{[[Command, 'Command palette', 'Jump to tables, views, forms and flows', '⌘ ⇧ K'], [CircleDot, 'Dirty fields', 'Highlight values changed on this form', 'Active'], [Activity, 'Form performance', 'Resources and execution timeline', '1.24 s'], [Network, 'Relationship map', 'Explore N:N and 1:N relationships', 'Open'], [GitFork, 'Repro recorder', 'Capture annotated steps for a ticket', 'Record'], [Zap, 'Metadata inspector', 'Hover fields for schema details', 'Active']].map(([Icon, a, b, c]: any) => <button key={a}><div><Icon /></div><section><b>{a}</b><span>{b}</span></section><em>{c}</em></button>)}</div></>}
      {view === 'settings' && <><Title title="Settings" text="Customize your Toolkit experience" /><div className="settings"><h3>Environments</h3>{environments.map(env => <button className="setting" key={env.id} onClick={() => switchEnvironment(env)}><div><i style={{ background: env.color }} /><span><b>{env.name}</b><small>{new URL(env.url).hostname}</small></span></div><em>{env.kind}</em></button>)}{!environments.length && <div className="notice">No environments saved yet.</div>}<button className="add" onClick={addEnvironment}>+ Add environment</button></div></>}
    </main><footer><span><CircleDot />{ctx.connected ? 'Connected to Dynamics 365' : 'Preview mode · Open Dynamics 365'}</span><span>v0.1.0</span></footer></div>;
}

function TraceCard({ log, open, copied, onToggle, onCopy, onOpen }: { log: TraceLog; open: boolean; copied: boolean; onToggle: () => void; onCopy: () => void; onOpen: () => void }) {
  const failed = Boolean(log.exceptiondetails);
  return <article className={`trace-card ${open ? 'expanded' : ''}`}><button className="trace-summary" onClick={onToggle} aria-expanded={open}><i className={failed ? 'exception' : 'success'} /><div><span>{failed ? 'Exception' : 'Success'} · {formatDate(log.createdon)} · {log.mode === 1 ? 'Async' : 'Sync'}</span><b>{log.typename || 'Plugin execution'}</b><small>{log.messagename || 'Unknown message'}{log.primaryentity ? ` · ${log.primaryentity}` : ''}</small></div><em>{log.performanceexecutionduration ?? 0} ms</em>{open ? <ChevronDown /> : <ChevronRight />}</button>{open && <div className="trace-details"><dl><div><dt>Operation type</dt><dd>{operationLabel(log.operationtype)}</dd></div><div><dt>Correlation ID</dt><dd>{log.correlationid || 'Not available'}</dd></div><div><dt>Created</dt><dd>{formatDate(log.createdon)}</dd></div><div><dt>Execution started</dt><dd>{formatDate(log.performanceexecutionstarttime)}</dd></div><div><dt>Constructor started</dt><dd>{formatDate(log.performanceconstructorstarttime)}</dd></div><div><dt>Duration</dt><dd>{log.performanceexecutionduration ?? 0} ms execution · {log.performanceconstructorduration ?? 0} ms constructor</dd></div><div><dt>Depth</dt><dd>{log.depth ?? 'Not available'}</dd></div></dl><section><label>MESSAGE BLOCK</label><pre>{log.messageblock || 'No message block was recorded.'}</pre></section>{log.exceptiondetails && <section className="exception-block"><label>EXCEPTION DETAILS</label><pre>{log.exceptiondetails}</pre></section>}<div className="trace-actions"><button onClick={onCopy}><Copy />{copied ? 'Copied' : 'Copy trace'}</button><button onClick={onOpen}><ExternalLink />Open in Dynamics</button></div></div>}</article>;
}

function formatDate(value?: string) { return value ? new Date(value).toLocaleString() : 'Not available'; }
function operationLabel(value?: number) { return value === 1 ? 'Plugin' : value === 2 ? 'Workflow activity' : value == null ? 'Not available' : `Type ${value}`; }
function formatTrace(log: TraceLog) { return [`Plugin: ${log.typename || 'Not available'}`, `Message: ${log.messagename || 'Not available'}`, `Outcome: ${log.exceptiondetails ? 'Exception' : 'Success'}`, `Mode: ${log.mode === 1 ? 'Asynchronous' : 'Synchronous'}`, `Operation: ${operationLabel(log.operationtype)}`, `Correlation ID: ${log.correlationid || 'Not available'}`, `Created: ${formatDate(log.createdon)}`, `Execution started: ${formatDate(log.performanceexecutionstarttime)}`, `Duration: ${log.performanceexecutionduration ?? 0} ms`, '', 'MESSAGE BLOCK', log.messageblock || 'Not available', ...(log.exceptiondetails ? ['', 'EXCEPTION DETAILS', log.exceptiondetails] : [])].join('\n'); }
function Title({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) { return <div className="title"><div><h2>{title}</h2><p>{text}</p></div>{children}</div>; }
createRoot(document.getElementById('root')!).render(<App />);
