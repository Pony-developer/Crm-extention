import type { CrmContext, ToolMessage } from '../shared/types';

type FieldInfo = { name: string; schema: string; type: string; required: string; dirty: boolean; controlNames: string[] };
type PageEvent = { channel?: string; direction?: string; event?: string; payload?: any };
const CHANNEL = 'dynamics-toolkit';
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function callPage<T>(action: string, payload?: unknown, timeout = 1500): Promise<T> {
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
  root.innerHTML = `<style>:host{all:initial}.badge{position:fixed;right:18px;bottom:18px;z-index:2147483647;font:13px Segoe UI,sans-serif;background:#111927;color:#fff;border:1px solid #334155;border-radius:12px;padding:8px;display:flex;align-items:center;gap:9px;box-shadow:0 12px 30px #0004}.mark{height:27px;width:27px;border-radius:8px;background:#8155ff;display:grid;place-items:center;font-weight:800}.meta{max-width:190px}.meta>*{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta small{color:#9ca7b8}.copy{border:0;background:#243044;color:#dbe4f0;border-radius:7px;padding:7px;cursor:pointer}.toast,.tip{position:fixed;z-index:2147483647;background:#111927;color:#fff;border:1px solid #40506a;padding:9px 12px;border-radius:8px;font:12px Segoe UI;pointer-events:none}.toast{right:18px;bottom:82px;opacity:0;transition:.2s}.toast.on{opacity:1}.tip{display:none;max-width:min(360px,calc(100vw - 16px))}.tip b,.tip span{display:block}.tip span{color:#aab6c9;margin-top:3px}.palette{display:none;position:fixed;inset:0;z-index:2147483646;background:#02061777;place-items:start center;padding-top:12vh;font:14px Segoe UI}.palette.open{display:grid}.panel{width:min(590px,88vw);border:1px solid #475569;background:#101827;border-radius:14px;color:white;overflow:hidden}.search{display:flex;gap:12px;padding:17px;border-bottom:1px solid #263449}.search input{width:100%;background:none;border:0;outline:0;color:white;font-size:16px}.result{padding:13px 17px;color:#aeb9ca}</style><div class="badge"><div class="mark">D</div><div class="meta"><b>${escapeHtml(context.recordName || context.entityName || 'Dynamics record')}</b><small>${escapeHtml([context.entityName, context.recordId?.slice(0,8), context.formName].filter(Boolean).join(' · '))}</small></div><button class="copy">Copy</button></div><div class="toast">Context copied</div><div class="tip"></div><div class="palette"><div class="panel"><div class="search"><span>⌘K</span><input placeholder="Search tables, forms, views and flows…"/></div><div class="result">Type a component name to search in Dynamics</div></div></div>`;
  const controller = new AbortController();
  const fields = new Map(initialFields.map(field => [field.name, field]));
  const decorated = new Map<HTMLElement, { field: string; enter: (event: PointerEvent) => void; leave: () => void }>();
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
  function updateMarks() {
    for (const [node, binding] of decorated) {
      const dirty = fields.get(binding.field)?.dirty;
      node.style.outline = dirty ? '2px solid #f59e0b' : '';
      node.style.outlineOffset = dirty ? '2px' : '';
    }
  }
  function updateField(name: string, dirty: boolean) { const field = fields.get(name); if (field) field.dirty = dirty; updateMarks(); }
  const observer = new MutationObserver(scan); observer.observe(document.documentElement, { childList: true, subtree: true }); scan();
  return {
    root, palette: root.querySelector('.palette')!, updateField,
    updateFields(states: Array<{ name: string; dirty: boolean }>) { states.forEach(state => updateField(state.name, state.dirty)); },
    cleanup() { observer.disconnect(); controller.abort(); for (const [node, binding] of decorated) { node.removeEventListener('pointerenter', binding.enter); node.removeEventListener('pointermove', positionTip); node.removeEventListener('pointerleave', binding.leave); node.style.outline=''; node.style.outlineOffset=''; } host.remove(); },
  };
}

export default defineContentScript({
  matches: ['https://*.dynamics.com/*'], allFrames: true,
  async main() {
    let current: { context: CrmContext; ui: ReturnType<typeof installUi> } | undefined;
    let stopped = false;
    let navigationTimer: number | undefined;
    async function initialize() {
      const context = await callPage<CrmContext>('context').catch(() => undefined);
      if (!context || stopped) return;
      const key = `${context.entityName}:${context.recordId}`;
      if (current && `${current.context.entityName}:${current.context.recordId}` === key) return;
      current?.ui.cleanup();
      const fields = await callPage<FieldInfo[]>('fields').catch(() => []);
      if (stopped) return;
      current = { context, ui: installUi(context, fields) };
      await browser.runtime.sendMessage({ type: 'REGISTER_CONTEXT', context } satisfies ToolMessage).catch(() => undefined);
    }
    const onPageEvent = (event: MessageEvent<PageEvent>) => {
      if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'event') return;
      if (event.data.event === 'attribute-change') current?.ui.updateField(event.data.payload?.name, Boolean(event.data.payload?.dirty));
      if (event.data.event === 'fields-state') current?.ui.updateFields(event.data.payload?.fields ?? []);
    };
    const onRuntimeMessage = async (message: ToolMessage) => {
      if (message.type === 'GET_CONTEXT') return current?.context;
      if (message.type === 'OPEN_PALETTE') { current?.ui.palette.classList.add('open'); (current?.ui.root.querySelector('input') as HTMLInputElement)?.focus(); }
      if (message.type === 'TOGGLE_THEME') document.documentElement.style.filter = message.enabled ? 'invert(.88) hue-rotate(180deg)' : '';
    };
    const cleanup = () => { if (stopped) return; stopped = true; if (navigationTimer !== undefined) clearInterval(navigationTimer); window.removeEventListener('message', onPageEvent); window.removeEventListener('pagehide', cleanup); browser.runtime.onMessage.removeListener(onRuntimeMessage); current?.ui.cleanup(); };
    window.addEventListener('message', onPageEvent); window.addEventListener('pagehide', cleanup); browser.runtime.onMessage.addListener(onRuntimeMessage);
    await initialize();
    navigationTimer = window.setInterval(initialize, 1000);
  },
});
