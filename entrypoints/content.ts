import type { ComponentSearchResult, CrmContext, ToolMessage } from '../shared/types';

type FieldInfo = { name: string; schema: string; type: string; required: string; dirty: boolean; controlNames: string[] };
type PageEvent = { channel?: string; direction?: string; event?: string; payload?: any };
const CHANNEL = 'dynamics-toolkit';
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function callPage<T>(action: string, payload?: unknown, timeout = 10_000): Promise<T> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Dynamics page bridge timed out')); }, timeout);
    function receive(event: MessageEvent) {
      if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'response' || event.data.id !== id) return;
      clearTimeout(timer); window.removeEventListener('message', receive);
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
    }
    window.addEventListener('message', receive);
    window.postMessage({ channel: CHANNEL, direction: 'request', id, action, payload }, '*');
  });
}

function installUi(context: CrmContext, initialFields: FieldInfo[]) {
  document.getElementById('dt-host')?.remove();
  const host = document.createElement('div'); host.id = 'dt-host'; document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>:host{all:initial}.badge{position:fixed;right:18px;bottom:18px;z-index:2147483647;font:13px Segoe UI,sans-serif;background:#111927;color:#fff;border:1px solid #334155;border-radius:12px;padding:8px;display:flex;align-items:center;gap:9px;box-shadow:0 12px 30px #0004}.mark{height:27px;width:27px;border-radius:8px;background:#8155ff;display:grid;place-items:center;font-weight:800}.meta{max-width:190px}.meta>*{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta small{color:#9ca7b8}.copy{border:0;background:#243044;color:#dbe4f0;border-radius:7px;padding:7px;cursor:pointer}.toast,.tip{position:fixed;z-index:2147483647;background:#111927;color:#fff;border:1px solid #40506a;padding:9px 12px;border-radius:8px;font:12px Segoe UI;pointer-events:none}.toast{right:18px;bottom:82px;opacity:0;transition:.2s}.toast.on{opacity:1}.tip{display:none}.tip b,.tip span{display:block}.tip span{color:#aab6c9;margin-top:3px}.palette{display:none;position:fixed;inset:0;z-index:2147483646;background:#02061777;place-items:start center;padding-top:12vh;font:14px Segoe UI}.palette.open{display:grid}.panel{width:min(590px,88vw);border:1px solid #475569;background:#101827;border-radius:14px;color:white;overflow:hidden;box-shadow:0 24px 70px #0008}.search{display:flex;gap:12px;padding:17px;border-bottom:1px solid #263449}.search input{width:100%;background:none;border:0;outline:0;color:white;font-size:16px}.results{max-height:420px;overflow:auto;margin:0;padding:6px;list-style:none}.state{padding:16px;color:#aeb9ca}.item{display:flex;align-items:center;gap:12px;padding:11px;border-radius:8px;cursor:pointer}.item.selected,.item:hover{background:#27344a}.kind{font-size:10px;text-transform:uppercase;color:#bba7ff;background:#31265b;padding:4px 6px;border-radius:5px;white-space:nowrap}.item-text{min-width:0}.item b,.item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item small{color:#97a5ba;margin-top:3px}.dirty{outline:2px solid #f59e0b!important;outline-offset:2px}</style><div class="badge"><div class="mark">D</div><div class="meta"><b>${escapeHtml(context.recordName || context.entityName || 'Dynamics record')}</b><small>${escapeHtml([context.entityName, context.recordId?.slice(0,8), context.formName].filter(Boolean).join(' · '))}</small></div><button class="copy">Copy</button></div><div class="toast">Context copied</div><div class="tip"></div><div class="palette" role="dialog" aria-label="Dynamics component search"><div class="panel"><div class="search"><span>⌘K</span><input aria-label="Search Dynamics components" autocomplete="off" placeholder="Search tables, forms, views, plugin steps and flows…"/></div><ul class="results" role="listbox"><li class="state">Type a component name to search in Dynamics</li></ul></div></div>`;
  root.querySelector('.copy')!.addEventListener('click', async () => { await navigator.clipboard.writeText(`Record ID: ${context.recordId}\nEntity: ${context.entityName}\nForm: ${context.formName}`); const toast=root.querySelector('.toast')!;toast.classList.add('on');setTimeout(()=>toast.classList.remove('on'),1200); });
  const tip = root.querySelector('.tip') as HTMLElement;
  root.querySelector('.copy')!.addEventListener('click', async () => { await navigator.clipboard.writeText(`Record ID: ${context.recordId}\nEntity: ${context.entityName}\nForm: ${context.formName}`); const toast=root.querySelector('.toast')!;toast.classList.add('on');setTimeout(()=>toast.classList.remove('on'),1200); }, { signal: controller.signal });

  const positionTip = (event: PointerEvent) => {
    const gap = 12; const bounds = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(event.clientX + gap, innerWidth - bounds.width - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(event.clientY + gap, innerHeight - bounds.height - 8))}px`;
  };
  const interactive = (node: Element) => node.matches('input,textarea,select,button,[role="combobox"],[contenteditable="true"]');
  const idsFor = (controlName: string) => [
    `${controlName}.fieldControl-text-box-text`, `${controlName}.fieldControl-option-set-select`,
    `${controlName}.fieldControl-date-time-input`, `${controlName}.fieldControl-checkbox-toggle`,
    `${controlName}.fieldControl-LookupResultsDropdown_${controlName}_textInputBox_with_filter_new`,
  ];
  function findControls(field: FieldInfo) {
    const result = new Set<HTMLElement>();
    for (const name of field.controlNames) for (const id of idsFor(name)) {
      const candidate = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
      if (!candidate) continue;
      const control = interactive(candidate) ? candidate : candidate.querySelector<HTMLElement>('input,textarea,select,button,[role="combobox"],[contenteditable="true"]');
      if (control) result.add(control);
    }
    return result;
  }
  function scan() {
    for (const field of fields.values()) for (const node of findControls(field)) {
      if (decorated.has(node)) continue;
      const enter = (event: PointerEvent) => { const current = fields.get(field.name) ?? field; tip.innerHTML=`<b>${escapeHtml(current.schema)}</b><span>Logical: ${escapeHtml(current.name)} · ${escapeHtml(current.type)} · ${escapeHtml(current.required)}${current.dirty?' · modified':''}</span>`;tip.style.display='block';positionTip(event); };
      const leave = () => { tip.style.display='none'; };
      node.addEventListener('pointerenter', enter); node.addEventListener('pointermove', positionTip); node.addEventListener('pointerleave', leave);
      decorated.set(node, { field: field.name, enter, leave });
    }
    for (const [node, binding] of decorated) if (!node.isConnected) { node.removeEventListener('pointerenter', binding.enter); node.removeEventListener('pointermove', positionTip); node.removeEventListener('pointerleave', binding.leave); decorated.delete(node); }
    updateMarks();
  }
  const palette = root.querySelector<HTMLElement>('.palette')!;
  const input = root.querySelector<HTMLInputElement>('.search input')!;
  const list = root.querySelector<HTMLUListElement>('.results')!;
  let results: ComponentSearchResult[] = [];
  let selected = -1;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestNumber = 0;
  const state = (message: string) => { list.innerHTML = `<li class="state">${escapeHtml(message)}</li>`; };
  const render = () => {
    if (!results.length) { state('No matching components'); return; }
    list.innerHTML = results.map((item, index) => `<li class="item${index === selected ? ' selected' : ''}" role="option" aria-selected="${index === selected}" data-index="${index}"><span class="kind">${escapeHtml(item.type.replace('-', ' '))}</span><span class="item-text"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.subtitle ?? '')}</small></span></li>`).join('');
    list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  };
  const open = async (index: number) => {
    const item = results[index];
    if (!item) return;
    try { await callPage<boolean>('openComponent', item, 10000); palette.classList.remove('open'); }
    catch (error) { state(error instanceof Error ? error.message : 'Could not open component'); }
  };
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer); selected = -1;
    const current = ++requestNumber;
    const query = input.value.trim();
    if (!query) { results = []; state('Type a component name to search in Dynamics'); return; }
    state('Searching…');
    debounceTimer = setTimeout(async () => {
      try {
        const found = await callPage<ComponentSearchResult[]>('searchComponents', { query, limit: 20 }, 10000);
        if (current !== requestNumber) return;
        results = found; selected = results.length ? 0 : -1; render();
      } catch (error) {
        if (current === requestNumber) { results = []; selected = -1; state(error instanceof Error ? error.message : 'Search failed'); }
      }
    }, 300);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); palette.classList.remove('open'); return; }
    if (event.key === 'Enter') { event.preventDefault(); void open(selected); return; }
    if (!results.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    selected = event.key === 'ArrowDown' ? (selected + 1) % results.length : (selected - 1 + results.length) % results.length;
    render();
  });
  list.addEventListener('mousemove', event => { const row = (event.target as Element).closest<HTMLElement>('[data-index]'); if (row && selected !== Number(row.dataset.index)) { selected = Number(row.dataset.index); render(); } });
  list.addEventListener('click', event => { const row = (event.target as Element).closest<HTMLElement>('[data-index]'); if (row) void open(Number(row.dataset.index)); });
  palette.addEventListener('mousedown', event => { if (event.target === palette) palette.classList.remove('open'); });
  return { root, palette };
}

export default defineContentScript({
  matches: ['https://*.dynamics.com/*'], allFrames: true,
  async main() {
    const receivePerformance = (event: MessageEvent) => {
      if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'performance') return;
      void browser.runtime.sendMessage({ type: 'REGISTER_PERFORMANCE', snapshot: event.data.snapshot as PerformanceSnapshot } satisfies ToolMessage).catch(() => undefined);
    };
    window.addEventListener('message', receivePerformance);
    let context: CrmContext;
    try { context = await callPage<CrmContext>('context'); } catch { return; }
    const fields = await callPage<FieldInfo[]>('fields').catch(() => []);
    const ui = installUi(context, fields);
    window.addEventListener('message', event => {
      if (event.source === window && event.data?.channel === CHANNEL && event.data?.direction === 'event' && event.data?.action === 'fieldsChanged') ui?.applyFields(event.data.result ?? []);
    });
    await browser.runtime.sendMessage({ type: 'REGISTER_CONTEXT', context } satisfies ToolMessage).catch(() => undefined);
    browser.runtime.onMessage.addListener(async (message: ToolMessage) => {
      if (message.type === 'GET_CONTEXT') return context;
      if (message.type === 'RUN_REQUEST') return callPage<WebApiResponse>('request', message.request, 120000);
      if (message.type === 'CANCEL_REQUEST') return callPage('cancelRequest', { requestId: message.requestId });
      if (message.type === 'OPEN_PALETTE') { ui?.palette.classList.add('open'); (ui?.root.querySelector('input') as HTMLInputElement)?.focus(); }
      if (message.type === 'TOGGLE_THEME') document.documentElement.style.filter = message.enabled ? 'invert(.88) hue-rotate(180deg)' : '';
    };
    const cleanup = () => { if (stopped) return; stopped = true; if (navigationTimer !== undefined) clearInterval(navigationTimer); window.removeEventListener('message', onPageEvent); window.removeEventListener('pagehide', cleanup); browser.runtime.onMessage.removeListener(onRuntimeMessage); current?.ui.cleanup(); };
    window.addEventListener('message', onPageEvent); window.addEventListener('pagehide', cleanup); browser.runtime.onMessage.addListener(onRuntimeMessage);
    await initialize();
    navigationTimer = window.setInterval(initialize, 1000);
  },
});
