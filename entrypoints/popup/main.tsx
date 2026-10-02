import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Check, ChevronDown, ChevronLeft, CircleDot, Clock3, Code2, Command, Copy, Database, ExternalLink, FileSearch, GitFork, Moon, Network, Play, Plus, RefreshCw, Search, Settings, Sparkles, Square, Sun, Tags, Terminal, Trash2, Zap } from 'lucide-react';
import type { CrmContext, PerformanceSnapshot, RequestHistoryItem, SavedEnvironment, ToolMessage, WebApiHeader, WebApiMethod, WebApiRequest, WebApiResponse } from '../../shared/types';
import './style.css';
import { sendRuntimeMessage } from '../../shared/messaging';
import { Recorder } from './Recorder';
import { RelationshipsView } from './RelationshipsView';
import { Autocomplete } from './Autocomplete';
import { closeBrackets } from './balance';
import { createFilterProvider } from './filterSuggestions';
import { createExpandProvider } from './expandSuggestions';
import { entitySetFromPath, loadEntityMetadata, type EntityMetadata, type MetadataGet } from './entityMetadata';

type View = 'console' | 'traces' | 'tools' | 'settings' | 'performance' | 'relationships' | 'recorder';
type TraceLog = { plugintracelogid: string; typename?: string; messageblock?: string; exceptiondetails?: string; performanceexecutionduration?: number; createdon?: string; mode?: number };
type TraceResult = 'all' | 'success' | 'exception';
type TraceMode = 'all' | 'sync' | 'async';
type ContextState = 'loading' | 'connected-record' | 'connected-non-record' | 'not-dynamics' | 'bridge-error';
const tabs = [{id:'tools',label:'Tools',icon:Sparkles},{id:'console',label:'API Console',icon:Terminal},{id:'traces',label:'Trace Logs',icon:FileSearch}] as const;
const bodyMethods: WebApiMethod[] = ['POST','PATCH','PUT'];
const emptyHeader = (): WebApiHeader => ({name:'',value:''});
const describeError = (error: unknown) => error instanceof Error ? error.message : String(error);
const privateHeader = /auth|token|key|secret|cookie|session/i;
const historyItem = (item: RequestHistoryItem, includePayload: boolean): RequestHistoryItem => ({
  ...item,
  body: includePayload ? item.body : undefined,
  headers: (item.headers||[]).map(header => ({ name: header.name, value: includePayload && !privateHeader.test(header.name.trim()) ? header.value : '' })),
});

function App(){
 const [view,setView]=useState<View>('tools'),[ctx,setCtx]=useState<CrmContext>({connected:false}),[contextState,setContextState]=useState<ContextState>('loading'),[method,setMethod]=useState<WebApiMethod>('GET');
 const [path,setPath]=useState('/api/data/v9.2/accounts'),[body,setBody]=useState(`{\n  \n}`),[headers,setHeaders]=useState<WebApiHeader[]>([]);
 const [select,setSelect]=useState('name,revenue'),[filter,setFilter]=useState(''),[expand,setExpand]=useState(''),[orderby,setOrderby]=useState(''),[top,setTop]=useState('10');
 const [fetchMode,setFetchMode]=useState(false),[fetchXml,setFetchXml]=useState('<fetch top="10"><entity name="account"><attribute name="name" /></entity></fetch>');
 const [response,setResponse]=useState(''),[responseMeta,setResponseMeta]=useState<WebApiResponse|null>(null),[error,setError]=useState(''),[running,setRunning]=useState(false),[responseView,setResponseView]=useState<'json'|'table'>('json');
 const [history,setHistory]=useState<RequestHistoryItem[]>([]),[showHistory,setShowHistory]=useState(false),[dark,setDark]=useState(false),[copiedField,setCopiedField]=useState<string|null>(null),[showAllFields,setShowAllFields]=useState(false),[dirtyHighlight,setDirtyHighlight]=useState(true),[logicalNames,setLogicalNames]=useState(false),[logs,setLogs]=useState<TraceLog[]>([]),[traceError,setTraceError]=useState(''),[traceLoading,setTraceLoading]=useState(false),[environments,setEnvironments]=useState<SavedEnvironment[]>([]);
 const [traceSearch,setTraceSearch]=useState(''),[traceResult,setTraceResult]=useState<TraceResult>('all'),[traceMode,setTraceMode]=useState<TraceMode>('all'),[tracePeriod,setTracePeriod]=useState('7'),[tracePageSize,setTracePageSize]=useState(25),[expandedTrace,setExpandedTrace]=useState<string|null>(null),[copiedTrace,setCopiedTrace]=useState<string|null>(null);
 const [performance,setPerformance]=useState<PerformanceSnapshot|null>(null);
 const [customCss,setCustomCss]=useState(''),[customCssEnabled,setCustomCssEnabled]=useState(false),[cssSaved,setCssSaved]=useState(false);
 const [environmentMenu,setEnvironmentMenu]=useState(false),[editingEnvironment,setEditingEnvironment]=useState<SavedEnvironment|null>(null),[switchingEnvironment,setSwitchingEnvironment]=useState<string|null>(null);
 const [activeTabId,setActiveTabId]=useState<number|null>(null),[saveHistoryPayload,setSaveHistoryPayload]=useState(false);
 const requestId=useRef<string | undefined>(undefined);
 useEffect(()=>{
   let generation=0;
   let observedTabId:number|null=null;
   const loadContext=async(silent=false)=>{
     const current=++generation;
     // A silent refresh (in-app navigation) keeps the current record visible until the new one arrives.
     if(!silent){setContextState('loading'); setCtx({connected:false}); setActiveTabId(null)}
     try{
       const [tab]=await browser.tabs.query({active:true,currentWindow:true});
       if(current!==generation)return;
       observedTabId=tab?.id??null;
       const hostname=tab?.url?new URL(tab.url).hostname:'';
       if(!hostname.endsWith('.dynamics.com')){setContextState('not-dynamics');return}
       const value=await sendRuntimeMessage({type:'GET_ACTIVE_CONTEXT'} satisfies ToolMessage) as CrmContext|undefined;
       if(current!==generation)return;
       const [verifiedTab]=await browser.tabs.query({active:true,currentWindow:true});
       if(current!==generation)return;
       if(verifiedTab?.id!==tab?.id){void loadContext();return}
       if(!value?.connected){setCtx({connected:false});setActiveTabId(null);setContextState('bridge-error');return}
       setActiveTabId(tab?.id??null);setCtx(value);
       setContextState(value.entityName&&value.recordId?'connected-record':'connected-non-record');
     }catch{if(current===generation){setCtx({connected:false});setActiveTabId(null);setContextState('bridge-error')}}
   };
   const activated=()=>{void loadContext()};
   const contextChanged=(message:ToolMessage)=>{if(message.type==='ACTIVE_CONTEXT_CHANGED'&&message.tabId===observedTabId)void loadContext(true)};
   const updated=(tabId:number,change:{status?:string})=>{
     if(tabId!==observedTabId)return;
     if(change.status==='loading'){generation++;setContextState('loading');setCtx({connected:false});setActiveTabId(null)}
     else if(change.status==='complete')void loadContext();
   };
   void loadContext();browser.tabs.onActivated.addListener(activated);browser.tabs.onUpdated.addListener(updated);browser.runtime.onMessage.addListener(contextChanged);
   void browser.storage.local.get(['themeEnabled','customCssEnabled','customCss','environments','requestHistory','historyPayloadsEnabled','dirtyHighlightEnabled','logicalNamesEnabled']).then(async x=>{setDirtyHighlight(x.dirtyHighlightEnabled!==false);setLogicalNames(x.logicalNamesEnabled===true);
     const includePayload=Boolean(x.historyPayloadsEnabled);
     const stored=(x.requestHistory as RequestHistoryItem[]|undefined)||[];
     const safe=stored.map(item=>historyItem(item,includePayload));
     setDark(Boolean(x.themeEnabled));setCustomCssEnabled(Boolean(x.customCssEnabled));setCustomCss(typeof x.customCss==='string'?x.customCss:'');setEnvironments((x.environments as SavedEnvironment[])||[]);setHistory(safe);setSaveHistoryPayload(includePayload);
     if(JSON.stringify(safe)!==JSON.stringify(stored))await browser.storage.local.set({requestHistory:safe}).catch(()=>setError('Saved request history could not be cleaned in local storage.'));
   }).catch(()=>{});
   return()=>{generation++;browser.tabs.onActivated.removeListener(activated);browser.tabs.onUpdated.removeListener(updated);browser.runtime.onMessage.removeListener(contextChanged)};
 },[]);
 useEffect(()=>{const receive=(message:ToolMessage)=>{if(message.type==='REGISTER_PERFORMANCE')setPerformance(message.snapshot)};browser.runtime.onMessage.addListener(receive);sendRuntimeMessage({type:'GET_ACTIVE_PERFORMANCE'} satisfies ToolMessage).then(value=>setPerformance((value as PerformanceSnapshot|undefined)||null)).catch(()=>{});return()=>browser.runtime.onMessage.removeListener(receive)},[]);
 const buildPath=(odata:{select:string;filter:string;expand:string;orderby:string})=>{const [base,rawQuery='']=path.split('?',2);const params=new URLSearchParams(rawQuery);['$select','$filter','$expand','$orderby','$top','fetchXml'].forEach(key=>params.delete(key));if(fetchMode){if(fetchXml.trim())params.set('fetchXml',fetchXml.trim())}else{if(odata.select.trim())params.set('$select',odata.select.trim());if(odata.filter.trim())params.set('$filter',odata.filter.trim());if(odata.expand.trim())params.set('$expand',odata.expand.trim());if(odata.orderby.trim())params.set('$orderby',odata.orderby.trim());if(top.trim())params.set('$top',top.trim())}const query=params.toString();return `${base}${query?`?${query}`:''}`};
 const requestPath=useMemo(()=>buildPath({select,filter,expand,orderby}),[path,fetchMode,fetchXml,select,filter,expand,orderby,top]);
 const sendRequest=(request:WebApiRequest)=>{
   if(activeTabId===null||!ctx.orgUrl||!ctx.entityName||!ctx.recordId)return Promise.reject(new Error('Open a Dynamics record before running a request.'));
   return sendRuntimeMessage({type:'RUN_REQUEST',request,targetTabId:activeTabId,expectedContext:{orgUrl:ctx.orgUrl,entityName:ctx.entityName,recordId:ctx.recordId}} satisfies ToolMessage) as Promise<WebApiResponse>;
 };
 const saveHistory=async(item:RequestHistoryItem)=>{const safe=historyItem(item,saveHistoryPayload);const next=[safe,...history.filter(x=>x.id!==item.id)].slice(0,50);setHistory(next);try{await browser.storage.local.set({requestHistory:next});return true}catch{return false}};
 const toggleHistoryPayload=async(enabled:boolean)=>{const next=history.map(item=>historyItem(item,enabled));try{await browser.storage.local.set({historyPayloadsEnabled:enabled,requestHistory:next});setHistory(next);setSaveHistoryPayload(enabled)}catch{setError('History setting could not be saved in local storage.')}};
 const responseTable=useMemo(()=>{
   if(!response)return null;
   let parsed:unknown;try{parsed=JSON.parse(response)}catch{return null}
   const source=Array.isArray(parsed)?parsed:parsed&&typeof parsed==='object'&&Array.isArray((parsed as {value?:unknown}).value)?(parsed as {value:unknown[]}).value:parsed&&typeof parsed==='object'?[parsed]:null;
   if(!source||!source.length)return null;
   const rows=source.map((row):Record<string,unknown>=>row&&typeof row==='object'&&!Array.isArray(row)?row as Record<string,unknown>:{value:row});
   const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>!key.startsWith('@'));
   return {columns,rows}
 },[response]);
 const cell=(value:unknown)=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
 const hasRecordContext=contextState==='connected-record';
 const hasDynamicsContext=hasRecordContext;
 const metadataCache=useRef(new Map<string,Promise<EntityMetadata>>());
 const [entityMeta,setEntityMeta]=useState<EntityMetadata|null>(null);
 const expandProvider=useMemo(()=>entityMeta&&ctx.orgUrl?createExpandProvider(entityMeta,p=>metadataGetRef.current(p),ctx.orgUrl):undefined,[entityMeta,ctx.orgUrl]);
 const metadataGetRef=useRef<MetadataGet>(()=>Promise.reject(new Error('Metadata is not available.')));
 const filterProvider=useMemo(()=>entityMeta&&ctx.orgUrl?createFilterProvider(entityMeta,p=>metadataGetRef.current(p),ctx.orgUrl):undefined,[entityMeta,ctx.orgUrl]);
 const entitySet=entitySetFromPath(path);
 // Field and relationship names for the entity set in the path, loaded once per set, power the query autocomplete.
 useEffect(()=>{
   if(!hasRecordContext||activeTabId===null||!ctx.orgUrl||!entitySet){setEntityMeta(null);return}
   let stale=false;
   const key=`${ctx.orgUrl}|${entitySet}`;
   const metadataGet:MetadataGet=async metadataPath=>{
     const out=await sendRequest({requestId:crypto.randomUUID(),method:'GET',path:metadataPath,headers:[]});
     if(out.status>=400)throw new Error(`${out.status} ${out.statusText}`);
     return JSON.parse(out.body);
   };
   metadataGetRef.current=metadataGet;
   const timer=window.setTimeout(()=>{
     let pending=metadataCache.current.get(key);
     if(!pending){const created=loadEntityMetadata(metadataGet,entitySet);pending=created;metadataCache.current.set(key,created);created.catch(()=>{if(metadataCache.current.get(key)===created)metadataCache.current.delete(key)})}
     pending.then(meta=>{if(!stale)setEntityMeta(meta)},()=>{if(!stale)setEntityMeta(null)});
   },400);
   return()=>{stale=true;window.clearTimeout(timer)};
 },[hasRecordContext,activeTabId,ctx.orgUrl,ctx.recordId,entitySet]);
 const autoEntity=useRef<string | undefined>(undefined);
 // Point the console at the table of the open form (once per table), so the user does not start from "accounts".
 useEffect(()=>{
   if(!hasRecordContext||activeTabId===null||!ctx.orgUrl||!ctx.entityName)return;
   const entity=ctx.entityName,key=`${ctx.orgUrl}|${entity}`;
   if(autoEntity.current===key)return;
   autoEntity.current=key;
   void (async()=>{
     let entitySet=entity.endsWith('y')?`${entity.slice(0,-1)}ies`:entity.endsWith('s')?`${entity}es`:`${entity}s`;
     try{
       const out=await sendRequest({requestId:crypto.randomUUID(),method:'GET',path:`/api/data/v9.2/EntityDefinitions(LogicalName='${entity.replaceAll("'","''")}')?$select=EntitySetName`,headers:[]});
       const name=(JSON.parse(out.body) as {EntitySetName?:unknown}).EntitySetName;
       if(typeof name==='string'&&name)entitySet=name;
     }catch{/* Keep the naive plural; the user can still edit the path. */}
     if(autoEntity.current!==key)return;
     setPath(`/api/data/v9.2/${entitySet}`);setSelect('');setFilter('');setExpand('');setOrderby('');setTop('10');
     setFetchXml(`<fetch top="10"><entity name="${entity}"><all-attributes /></entity></fetch>`);
   })();
 },[hasRecordContext,activeTabId,ctx.orgUrl,ctx.entityName,ctx.recordId]);
 const run=async()=>{if(!hasDynamicsContext)return;const closed={select:closeBrackets(select),filter:closeBrackets(filter),expand:closeBrackets(expand),orderby:closeBrackets(orderby)};if(closed.select!==select)setSelect(closed.select);if(closed.filter!==filter)setFilter(closed.filter);if(closed.expand!==expand)setExpand(closed.expand);if(closed.orderby!==orderby)setOrderby(closed.orderby);const finalPath=buildPath(closed);if(method==='DELETE'&&!window.confirm(`Delete using ${finalPath}? This action may be irreversible.`))return;setError('');setResponse('');setResponseMeta(null);if(bodyMethods.includes(method)){try{JSON.parse(body)}catch(e){setError(`Invalid JSON body: ${describeError(e)}`);return}}const id=crypto.randomUUID();requestId.current=id;setRunning(true);const cleanHeaders=headers.filter(x=>x.name.trim());const item:RequestHistoryItem={id,timestamp:Date.now(),method,path:finalPath,body:bodyMethods.includes(method)?body:undefined,headers:cleanHeaders};try{const out=await sendRequest({requestId:id,method,path:finalPath,body:bodyMethods.includes(method)?body:undefined,headers:cleanHeaders});setResponseMeta(out);if(out.body){try{setResponse(JSON.stringify(JSON.parse(out.body),null,2))}catch{setResponse(out.body)}}else setResponse('(empty response body)');if(!await saveHistory({...item,status:out.status,statusText:out.statusText}))setError('Request completed, but its history could not be saved.')}catch(e){const message=describeError(e);setError(message.includes('AbortError')||message.toLowerCase().includes('aborted')?'Request cancelled.':`Request failed: ${message}`);await saveHistory(item)}finally{requestId.current=undefined;setRunning(false)}};
 const cancel=async()=>{if(!requestId.current)return;const cancelled=await sendRuntimeMessage({type:'CANCEL_REQUEST',requestId:requestId.current} satisfies ToolMessage).catch(()=>false);if(cancelled)setError('Cancelling request…');else setError('This request could not be cancelled.')};
 const restore=(item:RequestHistoryItem)=>{const [base,query='']=item.path.split('?',2);const params=new URLSearchParams(query);const savedFetchXml=params.get('fetchXml');setMethod(item.method);setPath(base||'');setBody(item.body||'{\n  \n}');setHeaders(item.headers);setFetchMode(savedFetchXml!==null);setFetchXml(savedFetchXml||'');setSelect(params.get('$select')||'');setFilter(params.get('$filter')||'');setExpand(params.get('$expand')||'');setOrderby(params.get('$orderby')||'');setTop(params.get('$top')||'');setShowHistory(false)};
 const copyField=async(key:string,value:string)=>{await navigator.clipboard.writeText(value);setCopiedField(key);window.setTimeout(()=>setCopiedField(current=>current===key?null:current),1200)};
 const primaryFields=['Record ID','Entity name'];
 const contextFields=hasRecordContext?([['Record ID',ctx.recordId],['Entity name',ctx.entityName],['Entity display name',ctx.entityDisplayName],['Record name',ctx.recordName],['Form name',ctx.formName],['Form ID',ctx.formId],['App unique name',ctx.appUniqueName],['App ID',ctx.appId],['Org URL',ctx.orgUrl]] as [string,string|undefined][]).filter((field):field is [string,string]=>Boolean(field[1])):[];
 const theme=async()=>{const next=!dark;setDark(next);await browser.storage.local.set({themeEnabled:next});await sendRuntimeMessage({type:'SET_THEME',enabled:next} satisfies ToolMessage).catch(()=>{})};
 const saveCustomCss=async()=>{await browser.storage.local.set({customCssEnabled,customCss});setCssSaved(true);window.setTimeout(()=>setCssSaved(false),1200)};
 const resetCustomCss=()=>{setCustomCss('');setCssSaved(false)};
 const loadTraces=async(pageSize=tracePageSize)=>{if(!hasDynamicsContext)return;setTraceLoading(true);setTraceError('');try{const params=new URLSearchParams({'$select':'plugintracelogid,typename,messageblock,exceptiondetails,performanceexecutionduration,createdon,mode','$orderby':'createdon desc','$top':String(pageSize)});const out=await sendRequest({requestId:crypto.randomUUID(),method:'GET',path:`/api/data/v9.2/plugintracelogs?${params.toString()}`});if(out.status<200||out.status>=300)throw Error(`${out.status} ${out.statusText}`);setLogs(JSON.parse(out.body).value||[])}catch(e){setTraceError(describeError(e))}finally{setTraceLoading(false)}};
 const visibleLogs=useMemo(()=>{const query=traceSearch.trim().toLocaleLowerCase();const cutoff=tracePeriod==='all'?0:Date.now()-Number(tracePeriod)*86400000;return logs.filter(log=>{const failed=Boolean(log.exceptiondetails);const mode=log.mode===0?'sync':'async';const haystack=[log.typename,log.messageblock,log.exceptiondetails].filter(Boolean).join('\n').toLocaleLowerCase();return (!query||haystack.includes(query))&&(traceResult==='all'||(traceResult==='exception')===failed)&&(traceMode==='all'||traceMode===mode)&&(!cutoff||Boolean(log.createdon&&new Date(log.createdon).getTime()>=cutoff))})},[logs,traceSearch,traceResult,traceMode,tracePeriod]);
 const copyTrace=async(log:TraceLog)=>{await navigator.clipboard.writeText(JSON.stringify(log,null,2));setCopiedTrace(log.plugintracelogid);window.setTimeout(()=>setCopiedTrace(current=>current===log.plugintracelogid?null:current),1200)};
 const openTrace=async(log:TraceLog)=>{try{await sendRuntimeMessage({type:'OPEN_COMPONENT',component:{id:log.plugintracelogid,type:'plugin-step',name:log.typename||'Plugin trace log',entityName:'plugintracelog'}} satisfies ToolMessage)}catch(e){setTraceError(`Could not open trace log: ${describeError(e)}`)}};
 const persistEnvironments=async(next:SavedEnvironment[])=>{setEnvironments(next);await browser.storage.local.set({environments:next})};
 const saveEnvironment=async(env:SavedEnvironment)=>{await persistEnvironments(environments.some(item=>item.id===env.id)?environments.map(item=>item.id===env.id?env:item):[...environments,env]);setEditingEnvironment(null)};
 const removeEnvironment=async(id:string)=>{if(window.confirm('Delete this saved environment?')){await persistEnvironments(environments.filter(env=>env.id!==id));setEditingEnvironment(null)}};
 const targetUrl=(env:SavedEnvironment,includeRecord:boolean)=>{const target=new URL('/main.aspx',env.url);if(ctx.appId)target.searchParams.set('appid',ctx.appId);else if(ctx.appUniqueName)target.searchParams.set('appname',ctx.appUniqueName);if(ctx.entityName){target.searchParams.set('etn',ctx.entityName);target.searchParams.set('pagetype',includeRecord?'entityrecord':'entitylist')}if(includeRecord&&ctx.recordId)target.searchParams.set('id',ctx.recordId);return target.toString()};
 const openTarget=async(env:SavedEnvironment,includeRecord:boolean)=>{const [tab]=await browser.tabs.query({active:true,currentWindow:true});if(tab?.id!=null)await browser.tabs.update(tab.id,{url:targetUrl(env,includeRecord)})};
 const switchEnvironment=async(env:SavedEnvironment)=>{setEnvironmentMenu(false);setSwitchingEnvironment(env.id);try{if(!hasRecordContext||!ctx.entityName||!ctx.recordId){await openTarget(env,false);return}const logicalName=ctx.entityName.replaceAll("'","''");const metadataUrl=new URL(`/api/data/v9.2/EntityDefinitions(LogicalName='${logicalName}')`,env.url);metadataUrl.searchParams.set('$select','EntitySetName');const metadata=await fetch(metadataUrl,{credentials:'include',headers:{Accept:'application/json'}});if(metadata.status===401||metadata.status===403){if(window.confirm(`Sign in to ${env.name} before switching. Open it now?`))await openTarget(env,true);return}if(!metadata.ok)throw Error(`Could not resolve table metadata (${metadata.status} ${metadata.statusText}).`);const entitySetName=String((await metadata.json() as {EntitySetName?:string}).EntitySetName||'');if(!entitySetName)throw Error('The target organization did not return an entity set name.');const recordUrl=new URL(`/api/data/v9.2/${encodeURIComponent(entitySetName)}(${ctx.recordId.replace(/[{}]/g,'')})`,env.url);const record=await fetch(recordUrl,{credentials:'include',headers:{Accept:'application/json'}});if(record.status===401||record.status===403){if(window.confirm(`Sign in to ${env.name} before switching. Open it now?`))await openTarget(env,true);return}if(record.status===404){if(window.confirm('This record does not exist in the target organization. Open the table without a record ID?'))await openTarget(env,false);return}if(!record.ok)throw Error(`Could not verify the target record (${record.status} ${record.statusText}).`);await openTarget(env,true)}catch(e){window.alert(describeError(e))}finally{setSwitchingEnvironment(null)}};
 const openTraceList=async()=>{if(!ctx.orgUrl)return;const target=new URL('/main.aspx',ctx.orgUrl);target.searchParams.set('pagetype','entitylist');target.searchParams.set('etn','plugintracelog');await browser.tabs.create({url:target.toString()})};
 const openMetadata=(entity:string)=>{setPath(`/api/data/v9.2/EntityDefinitions(LogicalName='${encodeURIComponent(entity)}')`);setFetchMode(false);setSelect('');setFilter('');setExpand('');setOrderby('');setTop('');setView('console')};
 const performanceLabel=performance?.formLoadDuration!=null?`${(performance.formLoadDuration/1000).toFixed(2)} s`:'Not captured';
 const contextInfo:Record<ContextState,{title:string;message:string}>={
  loading:{title:'Connecting to Dynamics…',message:'Checking the active tab for a supported Dynamics record page.'},
  'connected-record':{title:'Record connected',message:'The active Dynamics record context is ready.'},
  'connected-non-record':{title:'No record is open',message:'Open a model-driven app record form in Dynamics 365, then reopen the Toolkit.'},
  'not-dynamics':{title:'Dynamics 365 is not open',message:'Open a model-driven app record at a dynamics.com address, then reopen the Toolkit.'},
  'bridge-error':{title:'Could not connect to Dynamics',message:'Reload a supported Dynamics 365 record page and reopen the Toolkit so the page bridge can connect.'},
 };
 type ToolConfig=({icon:React.ComponentType;title:string;description:string;badge:string;disabled?:boolean}&({target:Extract<View,'performance'|'relationships'|'recorder'>}|{onClick:()=>void}));
 const tools:ToolConfig[]=[
  {icon:Command,title:'Command palette',description:'Jump to tables, views, forms and flows',badge:'⌘ ⇧ K',onClick:()=>{void sendRuntimeMessage<boolean>({type:'OPEN_PALETTE'} satisfies ToolMessage).then(opened=>{if(!opened)window.alert('The command palette could not be opened. Open a Dynamics record form and reload the tab if the problem continues.')}).catch(e=>window.alert(`The command palette could not be opened: ${describeError(e)}`))}},
  {icon:CircleDot,title:'Dirty fields',description:'Highlight values changed on this form',badge:dirtyHighlight?'On':'Off',onClick:()=>{const next=!dirtyHighlight;setDirtyHighlight(next);void browser.storage.local.set({dirtyHighlightEnabled:next})}},
  {icon:Tags,title:'Logical names',description:'Show names of fields, tabs, sections and controls on the form',badge:logicalNames?'On':'Off',onClick:()=>{const next=!logicalNames;setLogicalNames(next);void browser.storage.local.set({logicalNamesEnabled:next})}},
  {icon:Activity,title:'Form performance',description:'Resources and execution timeline',badge:performanceLabel,target:'performance'},
  {icon:Network,title:'Relationship map',description:'Explore N:N and 1:N relationships',badge:'Open',target:'relationships',disabled:!hasRecordContext},
  {icon:GitFork,title:'Repro recorder',description:'Capture annotated steps for a ticket',badge:'Record',target:'recorder'},
  {icon:Zap,title:'Metadata inspector',description:'Open metadata for the current table',badge:'Open',onClick:()=>ctx.entityName?openMetadata(ctx.entityName):window.alert('Open a Dynamics record first.')},
 ];
 useEffect(()=>{if(view==='traces'&&hasDynamicsContext&&!logs.length&&!traceLoading)void loadTraces()},[view]);
 if(view==='recorder')return <Recorder context={ctx} onClose={()=>setView('tools')}/>;
 return <div className="app"><header><div className="brand"><div className="logo"><img src="/icon/32.png" alt=""/></div><div><b>Dynamics Toolkit</b><span>Developer companion</span></div></div><div><button className="icon" aria-label={dark?'Disable Dynamics dark theme':'Enable Dynamics dark theme'} onClick={theme}>{dark?<Moon/>:<Sun/>}</button><button className="icon" aria-label="Open settings" onClick={()=>setView('settings')}><Settings/></button></div></header>
 <section className="environment-picker"><button className="environment" onClick={()=>setEnvironmentMenu(!environmentMenu)} aria-expanded={environmentMenu}><div className="env"><i/><div><span>CURRENT ENVIRONMENT</span><b>{ctx.orgName||'Dynamics 365'}</b></div><ChevronDown/></div><em>{environments.find(env=>env.url===ctx.orgUrl)?.kind||'ORG'}</em></button>{environmentMenu&&<div className="environment-menu">{environments.map(env=><button key={env.id} disabled={switchingEnvironment!==null} onClick={()=>switchEnvironment(env)}><i style={{background:env.color}}/><span><b>{env.name}</b><small>{new URL(env.url).hostname}</small></span><em>{switchingEnvironment===env.id?'Checking…':env.kind}</em></button>)}{!environments.length&&<div className="notice">Add an environment in Settings first.</div>}<button className="manage" onClick={()=>{setEnvironmentMenu(false);setView('settings')}}>Manage environments</button></div>}</section>
 <section className="record"><div className="record-icon"><Database/></div><div className="record-text"><span>{ctx.entityName||'No table'}</span><b>{ctx.recordName||contextInfo[contextState].title}</b><small>{ctx.recordId||'No active record'}</small></div>{contextFields.length>0&&<div className="record-fields">{(showAllFields?contextFields:contextFields.filter(([label])=>primaryFields.includes(label))).map(([label,value])=><button key={label} type="button" title={`Copy ${label}: ${value}`} onClick={()=>void copyField(label,value)}><span>{label}</span><code>{value}</code>{copiedField===label?<Check/>:<Copy/>}</button>)}{contextFields.length>primaryFields.length&&<button type="button" className="record-fields-toggle" aria-expanded={showAllFields} onClick={()=>setShowAllFields(!showAllFields)}>{showAllFields?'Show less':`Show more (${contextFields.length})`}<ChevronDown className={showAllFields?'open':''}/></button>}</div>}</section>
 {!hasRecordContext&&<div className={`context-notice ${contextState}`} role={contextState==='bridge-error'?'alert':'status'}><b>{contextInfo[contextState].title}</b><span>{contextInfo[contextState].message}</span></div>}
 <nav aria-label="Main tools">{tabs.map(t=><button key={t.id} className={view===t.id?'active':''} aria-current={view===t.id?'page':undefined} disabled={t.id==='traces'&&!hasDynamicsContext} onClick={()=>setView(t.id)}><t.icon/>{t.label}</button>)}</nav><main>
 {view==='console'&&<><Title title="Web API Console" text="Run authenticated requests through the Dynamics bridge"><button className="sub" onClick={()=>setShowHistory(!showHistory)}><Clock3/>History ({history.length})</button></Title>
 <label className="history-option"><input type="checkbox" checked={saveHistoryPayload} onChange={event=>void toggleHistoryPayload(event.target.checked)}/>Keep request bodies and non-sensitive header values in local history</label>
 {showHistory&&<div className="history">{history.length?history.map(item=><button key={item.id} onClick={()=>restore(item)}><b>{item.method}</b><span>{item.path}</span><em>{item.status?`${item.status} ${item.statusText}`:'Failed'} · {new Date(item.timestamp).toLocaleString()}</em></button>):<div className="notice">No requests yet.</div>}</div>}
 {!hasDynamicsContext&&<div className="notice">Web API requests require an active Dynamics 365 record page.</div>}<fieldset className="api-controls" disabled={!hasDynamicsContext}><div className="request"><select value={method} onChange={e=>setMethod(e.target.value as WebApiMethod)}>{['GET','POST','PATCH','PUT','DELETE'].map(x=><option key={x}>{x}</option>)}</select><input aria-label="Web API path" value={path} onChange={e=>setPath(e.target.value)}/>{running?<button className="cancel" onClick={cancel}><Square/>Stop</button>:<button onClick={run}><Play/>Run</button>}</div>
 <div className="builder"><div><label>QUERY BUILDER</label><button className={fetchMode?'active':''} onClick={()=>setFetchMode(!fetchMode)}><Code2/>{fetchMode?'OData mode':'FetchXML'}</button></div>{fetchMode?<textarea aria-label="FetchXML" value={fetchXml} onChange={e=>setFetchXml(e.target.value)}/>:<section className="query-fields">{([['$select',select,setSelect,entityMeta?.fields],['$filter',filter,setFilter,undefined],['$expand',expand,setExpand,undefined],['$orderby',orderby,setOrderby,entityMeta?.fields]] as const).map(([label,value,setter,options])=><label key={label}><b>{label}</b><Autocomplete ariaLabel={label} value={value} onChange={setter} options={options??[]} provider={label==='$filter'?filterProvider:label==='$expand'?expandProvider:undefined} placeholder={`Add ${label.slice(1)}`}/></label>)}<label><b>$top</b><input value={top} onChange={e=>setTop(e.target.value)} placeholder="Add top"/></label></section>}<small className="resolved">{requestPath}</small></div>
 {bodyMethods.includes(method)&&<div className="editor"><label>JSON BODY</label><textarea value={body} onChange={e=>setBody(e.target.value)} spellCheck={false}/></div>}
 <div className="editor headers"><div><label>ADDITIONAL HEADERS</label><button onClick={()=>setHeaders([...headers,emptyHeader()])}><Plus/>Add</button></div>{headers.map((header,index)=><section key={index}><input placeholder="Header name" value={header.name} onChange={e=>setHeaders(headers.map((x,i)=>i===index?{...x,name:e.target.value}:x))}/><input placeholder="Value" value={header.value} onChange={e=>setHeaders(headers.map((x,i)=>i===index?{...x,value:e.target.value}:x))}/><button aria-label="Remove header" onClick={()=>setHeaders(headers.filter((_,i)=>i!==index))}><Trash2/></button></section>)}</div>
 {error&&<div className="notice error">{error}</div>}<div className="response"><div><label>RESPONSE</label>{responseMeta&&<em className={responseMeta.status>=400?'bad':''}>{responseMeta.status} {responseMeta.statusText||'(no status text)'}</em>}</div>{responseTable&&<section className="response-tabs">{(['json','table'] as const).map(mode=><button key={mode} type="button" className={responseView===mode?'active':''} onClick={()=>setResponseView(mode)}>{mode==='json'?'JSON':`Table (${responseTable.rows.length})`}</button>)}</section>}{responseTable&&responseView==='table'?<section className="response-table"><table><thead><tr>{responseTable.columns.map(column=><th key={column}>{column}</th>)}</tr></thead><tbody>{responseTable.rows.map((row,index)=><tr key={index}>{responseTable.columns.map(column=><td key={column} title={cell(row[column])}>{cell(row[column])}</td>)}</tr>)}</tbody></table></section>:<pre>{response||'{\n  "ready": true,\n  "message": "Run a request to see results"\n}'}</pre>}</div></fieldset></>}
 {view==='traces'&&<><Title title="Plugin Trace Logs" text="Latest executions from this organization"><div className="title-actions"><button className="sub" onClick={()=>void openTraceList()} disabled={!ctx.orgUrl} title="Open the Plugin Trace Logs list in Dynamics" aria-label="Open Plugin Trace Logs in Dynamics"><ExternalLink/>Open in CRM</button><button className="sub" onClick={()=>void loadTraces()} disabled={traceLoading} aria-label="Refresh plugin trace logs"><RefreshCw className={traceLoading?'spin':''}/>{traceLoading?'Loading':'Refresh'}</button></div></Title><div className="filters trace-search"><Search aria-hidden="true"/><input aria-label="Search loaded trace logs" placeholder="Search message or plugin…" value={traceSearch} onChange={event=>setTraceSearch(event.target.value)}/></div><div className="trace-filter-grid"><label>RESULT<select aria-label="Execution result" value={traceResult} onChange={event=>setTraceResult(event.target.value as TraceResult)}><option value="all">All results</option><option value="success">Success</option><option value="exception">Exception</option></select></label><label>MODE<select aria-label="Execution mode" value={traceMode} onChange={event=>setTraceMode(event.target.value as TraceMode)}><option value="all">Sync & async</option><option value="sync">Synchronous</option><option value="async">Asynchronous</option></select></label><label>PERIOD<select aria-label="Trace period" value={tracePeriod} onChange={event=>setTracePeriod(event.target.value)}><option value="1">Last day</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">Any time</option></select></label><label>PAGE SIZE<select aria-label="Trace page size" value={tracePageSize} onChange={event=>{const size=Number(event.target.value);setTracePageSize(size);void loadTraces(size)}}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label></div>{traceError&&<div className="notice error" role="alert">{traceError}</div>}<p className="trace-count" aria-live="polite">Showing {visibleLogs.length} of {logs.length} loaded records</p><div className="logs">{visibleLogs.map(x=>{const expanded=expandedTrace===x.plugintracelogid;const status=x.exceptiondetails?'Exception':'Success';const mode=x.mode===0?'Synchronous':'Asynchronous';return <article key={x.plugintracelogid} className={expanded?'expanded':''}><button className="trace-summary" onClick={()=>setExpandedTrace(expanded?null:x.plugintracelogid)} aria-expanded={expanded} aria-controls={`trace-${x.plugintracelogid}`}><i className={x.exceptiondetails?'exception':'success'} aria-hidden="true"/><div><span><strong className={x.exceptiondetails?'status-exception':'status-success'}>{status}</strong> · {x.createdon?new Date(x.createdon).toLocaleString():'Unknown time'}</span><b>{x.typename||'Plugin execution'}</b></div><small>{x.performanceexecutionduration??0} ms</small><ChevronDown aria-hidden="true"/></button>{expanded&&<section className="trace-details" id={`trace-${x.plugintracelogid}`}><dl><div><dt>Status</dt><dd>{status}</dd></div><div><dt>Mode</dt><dd>{mode}</dd></div><div><dt>Duration</dt><dd>{x.performanceexecutionduration??0} ms</dd></div><div><dt>Created</dt><dd>{x.createdon?new Date(x.createdon).toLocaleString():'Unknown'}</dd></div></dl><h3>Message block</h3><pre>{x.messageblock||'No message block was recorded.'}</pre>{x.exceptiondetails&&<><h3>Exception details</h3><pre className="exception-text">{x.exceptiondetails}</pre></>}<div className="trace-actions"><button onClick={()=>void copyTrace(x)} aria-label={`Copy trace log ${x.typename||x.plugintracelogid}`}><Copy/>{copiedTrace===x.plugintracelogid?'Copied':'Copy record'}</button><button onClick={()=>void openTrace(x)} aria-label={`Open trace log ${x.typename||x.plugintracelogid} in Dynamics`}><ExternalLink/>Open in Dynamics</button></div></section>}</article>})}{!traceLoading&&!visibleLogs.length&&<div className="notice">No loaded trace logs match these filters.</div>}</div></>}
 {view==='tools'&&<><Title title="Developer Tools" text="Inspect, debug, and navigate faster"/><div className="tools">{tools.map(tool=><button key={tool.title} disabled={tool.disabled} onClick={'target' in tool?()=>setView(tool.target):tool.onClick}><div><tool.icon/></div><section><b>{tool.title}</b><span>{tool.description}</span></section><em>{tool.disabled?'Record required':tool.badge}</em></button>)}</div></>}
 {view==='performance'&&<PerformanceView snapshot={performance} onBack={()=>setView('tools')}/>}
 {view==='relationships'&&<><BackToTools onClick={()=>setView('tools')}/><RelationshipsView context={ctx} onOpenMetadata={openMetadata}/></>}
 {view==='settings'&&<><Title title="Settings" text="Customize your Toolkit experience"/><div className="settings"><h3>Custom CSS</h3><section className="custom-css"><div className="custom-css-heading"><span><b>Use custom CSS</b><small>Apply these styles to Dynamics pages</small></span><button type="button" role="switch" aria-checked={customCssEnabled} aria-label="Enable custom CSS" className={`toggle${customCssEnabled?' on':''}`} onClick={()=>{setCustomCssEnabled(!customCssEnabled);setCssSaved(false)}}><i/></button></div><textarea aria-label="Custom CSS" value={customCss} onChange={event=>{setCustomCss(event.target.value);setCssSaved(false)}} placeholder={'.your-selector {\n  color: #fff;\n}'} spellCheck={false}/><div className="custom-css-actions"><button type="button" className="reset" onClick={resetCustomCss}>Reset</button><button type="button" className="save" onClick={saveCustomCss}>{cssSaved?'Saved':'Save CSS'}</button></div></section><h3>Environments</h3>{environments.map(env=><div className="setting" key={env.id}><div><i style={{background:env.color}}/><span><b>{env.name}</b><small>{new URL(env.url).hostname}</small></span></div><em>{env.kind}</em><button aria-label={`Edit ${env.name}`} onClick={()=>setEditingEnvironment(env)}>Edit</button></div>)}{!environments.length&&<div className="notice">No environments saved yet.</div>}<button className="add" onClick={()=>setEditingEnvironment({id:crypto.randomUUID(),name:'',url:'',kind:'Dev',color:'#43db9b'})}>+ Add environment</button>{editingEnvironment&&<EnvironmentEditor environment={editingEnvironment} onSave={saveEnvironment} onDelete={removeEnvironment} onCancel={()=>setEditingEnvironment(null)}/>}</div></>}
 </main><footer><span><CircleDot/>{contextInfo[contextState].title}</span><span>v0.1.0</span></footer></div>
}
function BackToTools({onClick}:{onClick:()=>void}){return <button className="back view-back" onClick={onClick}><ChevronLeft/>Tools</button>}
function EnvironmentEditor({environment,onSave,onDelete,onCancel}:{environment:SavedEnvironment;onSave:(value:SavedEnvironment)=>void;onDelete:(id:string)=>void;onCancel:()=>void}){const [draft,setDraft]=useState(environment),[validation,setValidation]=useState('');const submit=()=>{try{const parsed=new URL(draft.url);if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.dynamics.com')||!draft.name.trim())throw Error();void onSave({...draft,name:draft.name.trim(),url:parsed.origin})}catch{setValidation('Enter a name and a valid HTTPS dynamics.com URL.')}};return <div className="editor-modal" role="dialog" aria-modal="true" aria-label="Environment editor"><form onSubmit={event=>{event.preventDefault();submit()}}><h3>{environment.name?'Edit environment':'Add environment'}</h3><label>Name<input autoFocus value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label><label>URL<input placeholder="https://org.crm.dynamics.com" value={draft.url} onChange={event=>setDraft({...draft,url:event.target.value})}/></label><div className="environment-fields"><label>Type<select value={draft.kind} onChange={event=>setDraft({...draft,kind:event.target.value as SavedEnvironment['kind']})}><option>Dev</option><option>Test</option><option>Prod</option></select></label><label>Color<input type="color" value={draft.color} onChange={event=>setDraft({...draft,color:event.target.value})}/></label></div>{validation&&<div className="notice error">{validation}</div>}<footer>{environment.name&&<button type="button" className="delete" onClick={()=>void onDelete(environment.id)}>Delete</button>}<span/><button type="button" onClick={onCancel}>Cancel</button><button type="submit" className="save">Save</button></footer></form></div>}
function PerformanceView({snapshot,onBack}:{snapshot:PerformanceSnapshot|null;onBack:()=>void}){
 const resources=useMemo(()=>snapshot?[...snapshot.resources].sort((a,b)=>b.duration-a.duration):[],[snapshot]);
 return <><BackToTools onClick={onBack}/><Title title="Form performance" text="Live browser timings from the active Dynamics form"/>
  {!snapshot?<div className="notice">Not captured. Open or reload a Dynamics record form to collect performance data.</div>:<>
   <div className="performance-summary"><article><span>FORM READY</span><b>{snapshot.formLoadDuration!=null?`${snapshot.formLoadDuration.toFixed(0)} ms`:'Not captured'}</b><small>{snapshot.formLoadSource.replaceAll('-',' ')}</small></article><article><span>RESOURCES</span><b>{snapshot.resourceCount}</b><small>{new Date(snapshot.capturedAt).toLocaleTimeString()}</small></article><article><span>LONG TASKS</span><b>{snapshot.longTasks.length}</b><small>{snapshot.supportsLongTasks?'observed':'unsupported'}</small></article></div>
   <section className="timing-section"><h3>Resource timings</h3>{resources.length===0?<div className="notice">No resource timings captured.</div>:<div className="timing-list">{resources.map((resource,index)=><article key={`${resource.startOffset}:${resource.url}:${index}`}><div><b title={resource.url}>{resource.name||resource.url}</b><span>{resource.initiatorType||'other'} · {formatBytes(resource.transferSize)}</span></div><em>{resource.duration.toFixed(1)} ms</em></article>)}</div>}</section>
   <section className="timing-section"><h3>Long tasks</h3>{!snapshot.supportsLongTasks?<div className="notice">Long Task API is not supported by this browser.</div>:snapshot.longTasks.length===0?<div className="notice">No long tasks captured.</div>:<div className="timing-list">{snapshot.longTasks.map((task,index)=><article key={`${task.startOffset}:${index}`}><div><b>{task.attribution||'Main thread task'}</b><span>Started at {task.startOffset.toFixed(1)} ms</span></div><em>{task.duration.toFixed(1)} ms</em></article>)}</div>}</section>
  </>}
 </>
}
function formatBytes(bytes:number){if(!bytes)return 'size unavailable';if(bytes<1024)return `${bytes} B`;return `${(bytes/1024).toFixed(1)} KB`}
function Title({title,text,children}:{title:string;text:string;children?:React.ReactNode}){return <div className="title"><div><h2>{title}</h2><p>{text}</p></div>{children}</div>}
createRoot(document.getElementById('root')!).render(<App/>);
