import type { CrmContext, ToolMessage } from '../shared/types';

type FieldInfo = { name: string; schema: string; type: string; required: string; dirty: boolean };
const CHANNEL = 'dynamics-toolkit';
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function callPage<T>(action: string, payload?: unknown, timeout = 4000): Promise<T> {
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

let uiAbort: AbortController | undefined;
function installUi(context: CrmContext, fields: FieldInfo[]) {
  uiAbort?.abort();
  uiAbort = new AbortController();
  const signal = uiAbort.signal;
  document.getElementById('dt-host')?.remove();
  document.querySelectorAll<HTMLElement>('[data-dt-dirty]').forEach(node => {
    node.style.outline = node.dataset.dtPreviousOutline ?? '';
    node.style.outlineOffset = node.dataset.dtPreviousOutlineOffset ?? '';
    delete node.dataset.dtDirty;
    delete node.dataset.dtPreviousOutline;
    delete node.dataset.dtPreviousOutlineOffset;
  });
  const host = document.createElement('div'); host.id = 'dt-host'; document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>:host{all:initial}.badge{position:fixed;right:18px;bottom:18px;z-index:2147483647;font:13px Segoe UI,sans-serif;background:#111927;color:#fff;border:1px solid #334155;border-radius:12px;padding:8px;display:flex;align-items:center;gap:9px;box-shadow:0 12px 30px #0004}.mark{height:27px;width:27px;border-radius:8px;background:#8155ff;display:grid;place-items:center;font-weight:800}.meta{max-width:190px}.meta>*{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta small{color:#9ca7b8}.copy{border:0;background:#243044;color:#dbe4f0;border-radius:7px;padding:7px;cursor:pointer}.toast,.tip{position:fixed;z-index:2147483647;background:#111927;color:#fff;border:1px solid #40506a;padding:9px 12px;border-radius:8px;font:12px Segoe UI;pointer-events:none}.toast{right:18px;bottom:82px;opacity:0;transition:.2s}.toast.on{opacity:1}.tip{display:none}.tip b,.tip span{display:block}.tip span{color:#aab6c9;margin-top:3px}.palette{display:none;position:fixed;inset:0;z-index:2147483646;background:#02061777;place-items:start center;padding-top:12vh;font:14px Segoe UI}.palette.open{display:grid}.panel{width:min(590px,88vw);border:1px solid #475569;background:#101827;border-radius:14px;color:white;overflow:hidden}.search{display:flex;gap:12px;padding:17px;border-bottom:1px solid #263449}.search input{width:100%;background:none;border:0;outline:0;color:white;font-size:16px}.result{padding:13px 17px;color:#aeb9ca}.dirty{outline:2px solid #f59e0b!important;outline-offset:2px}</style><div class="badge"><div class="mark">D</div><div class="meta"><b>${escapeHtml(context.recordName || context.entityName || 'Dynamics record')}</b><small>${escapeHtml([context.entityName, context.recordId?.slice(0,8), context.formName].filter(Boolean).join(' · '))}</small></div><button class="copy">Copy</button></div><div class="toast">Context copied</div><div class="tip"></div><div class="palette"><div class="panel"><div class="search"><span>⌘K</span><input placeholder="Search tables, forms, views and flows…"/></div><div class="result">Type a component name to search in Dynamics</div></div></div>`;
  root.querySelector('.copy')!.addEventListener('click', async () => { await navigator.clipboard.writeText(`Record ID: ${context.recordId}\nEntity: ${context.entityName}\nForm: ${context.formName}`); const toast=root.querySelector('.toast')!;toast.classList.add('on');setTimeout(()=>toast.classList.remove('on'),1200); }, { signal });
  const tip = root.querySelector('.tip') as HTMLElement;
  for (const field of fields) {
    const nodes = document.querySelectorAll<HTMLElement>(`[data-id*="${CSS.escape(field.name)}"]`);
    nodes.forEach(node => {
      if (field.dirty) { node.dataset.dtPreviousOutline = node.style.outline; node.dataset.dtPreviousOutlineOffset = node.style.outlineOffset; node.dataset.dtDirty = ''; node.style.outline = '2px solid #f59e0b'; node.style.outlineOffset = '2px'; }
      node.addEventListener('pointerenter', event => { tip.innerHTML=`<b>${escapeHtml(field.schema)}</b><span>Logical: ${escapeHtml(field.name)} · ${escapeHtml(field.type)} · ${escapeHtml(field.required)}${field.dirty?' · modified':''}</span>`;tip.style.display='block';tip.style.left=`${(event as PointerEvent).clientX+12}px`;tip.style.top=`${(event as PointerEvent).clientY+12}px`; }, { signal });
      node.addEventListener('pointerleave', () => { tip.style.display='none'; }, { signal });
    });
  }
  return { root, palette: root.querySelector('.palette')! };
}

export default defineContentScript({
  matches: ['https://*.dynamics.com/*'], allFrames: true,
  async main() {
    let context: CrmContext = { connected: false };
    let fields: FieldInfo[] = [];
    let ui: ReturnType<typeof installUi>;
    const applyContext = async (nextContext: CrmContext, nextFields: FieldInfo[]) => {
      context = nextContext;
      fields = nextFields;
      ui = installUi(context, fields);
      await browser.runtime.sendMessage({ type: 'REGISTER_CONTEXT', context } satisfies ToolMessage).catch(() => undefined);
    };
    const receivePageEvent = (event: MessageEvent) => {
      if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'event') return;
      if (event.data.type === 'CONTEXT_CHANGED') void applyContext(event.data.context, event.data.fields ?? []);
      else if (event.data.type === 'FIELD_STATE_CHANGED' && context.connected) {
        fields = event.data.fields ?? [];
        ui = installUi(context, fields);
      }
    };
    window.addEventListener('message', receivePageEvent);
    try {
      const initialContext = await callPage<CrmContext>('context');
      const initialFields = await callPage<FieldInfo[]>('fields').catch(() => []);
      await applyContext(initialContext, initialFields);
    } catch { /* The MAIN-world bridge continues its bounded retries during UCI navigation. */ }
    browser.runtime.onMessage.addListener(async (message: ToolMessage) => {
      if (message.type === 'GET_CONTEXT') return context;
      if (message.type === 'OPEN_PALETTE') { ui?.palette.classList.add('open'); (ui?.root.querySelector('input') as HTMLInputElement)?.focus(); }
      if (message.type === 'TOGGLE_THEME') document.documentElement.style.filter = message.enabled ? 'invert(.88) hue-rotate(180deg)' : '';
    });
  },
});
