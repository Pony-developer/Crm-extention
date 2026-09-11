import type { BridgeRequest, BridgeResponse, CrmContext, DataverseResponse, FieldInfo, ToolMessage } from '../shared/types';

const CHANNEL = 'dynamics-toolkit' as const;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

type BridgeResults = { context: CrmContext; fields: FieldInfo[]; request: DataverseResponse };
type BridgePayloads = {
  context: null;
  fields: null;
  request: Extract<BridgeRequest, { action: 'request' }>['payload'];
};

function createBridge(token: string) {
  const pending = new Map<string, { resolve(value: BridgeResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
    const response = event.data as Partial<BridgeResponse>;
    if (response.channel !== CHANNEL || response.direction !== 'response' || typeof response.id !== 'string') return;
    if (response.action !== 'handshake' && response.token !== token) return;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    entry.resolve(response as BridgeResponse);
  };
  window.addEventListener('message', receive);

  const send = (request: BridgeRequest, timeout = 1500) => new Promise<BridgeResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(request.id);
      reject(new Error('Dynamics page bridge timed out'));
    }, timeout);
    pending.set(request.id, { resolve, reject, timer });
    window.postMessage(request, window.location.origin);
  });

  return {
    async handshake() {
      const response = await send({ channel: CHANNEL, direction: 'request', id: crypto.randomUUID(), action: 'handshake', payload: { token } });
      if ('error' in response) throw new Error(response.error);
      if (response.action !== 'handshake' || response.token !== token || !response.result.accepted) throw new Error('Invalid bridge handshake response');
    },
    async call<A extends keyof BridgeResults>(action: A, payload: BridgePayloads[A]): Promise<BridgeResults[A]> {
      const request = { channel: CHANNEL, direction: 'request', id: crypto.randomUUID(), action, token, payload } as BridgeRequest;
      const response = await send(request);
      if ('error' in response) throw new Error(response.error);
      if (response.action !== action) throw new Error('Bridge returned a mismatched action');
      return response.result as BridgeResults[A];
    },
    teardown() {
      window.removeEventListener('message', receive);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Dynamics page bridge was torn down'));
      }
      pending.clear();
    },
  };
}

function installUi(context: CrmContext, fields: FieldInfo[]) {
  if (document.getElementById('dt-host')) return;
  const host = document.createElement('div'); host.id = 'dt-host'; document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>:host{all:initial}.badge{position:fixed;right:18px;bottom:18px;z-index:2147483647;font:13px Segoe UI,sans-serif;background:#111927;color:#fff;border:1px solid #334155;border-radius:12px;padding:8px;display:flex;align-items:center;gap:9px;box-shadow:0 12px 30px #0004}.mark{height:27px;width:27px;border-radius:8px;background:#8155ff;display:grid;place-items:center;font-weight:800}.meta{max-width:190px}.meta>*{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta small{color:#9ca7b8}.copy{border:0;background:#243044;color:#dbe4f0;border-radius:7px;padding:7px;cursor:pointer}.toast,.tip{position:fixed;z-index:2147483647;background:#111927;color:#fff;border:1px solid #40506a;padding:9px 12px;border-radius:8px;font:12px Segoe UI;pointer-events:none}.toast{right:18px;bottom:82px;opacity:0;transition:.2s}.toast.on{opacity:1}.tip{display:none}.tip b,.tip span{display:block}.tip span{color:#aab6c9;margin-top:3px}.palette{display:none;position:fixed;inset:0;z-index:2147483646;background:#02061777;place-items:start center;padding-top:12vh;font:14px Segoe UI}.palette.open{display:grid}.panel{width:min(590px,88vw);border:1px solid #475569;background:#101827;border-radius:14px;color:white;overflow:hidden}.search{display:flex;gap:12px;padding:17px;border-bottom:1px solid #263449}.search input{width:100%;background:none;border:0;outline:0;color:white;font-size:16px}.result{padding:13px 17px;color:#aeb9ca}.dirty{outline:2px solid #f59e0b!important;outline-offset:2px}</style><div class="badge"><div class="mark">D</div><div class="meta"><b>${escapeHtml(context.recordName || context.entityName || 'Dynamics record')}</b><small>${escapeHtml([context.entityName, context.recordId?.slice(0,8), context.formName].filter(Boolean).join(' · '))}</small></div><button class="copy">Copy</button></div><div class="toast">Context copied</div><div class="tip"></div><div class="palette"><div class="panel"><div class="search"><span>⌘K</span><input placeholder="Search tables, forms, views and flows…"/></div><div class="result">Type a component name to search in Dynamics</div></div></div>`;
  root.querySelector('.copy')!.addEventListener('click', async () => { await navigator.clipboard.writeText(`Record ID: ${context.recordId}\nEntity: ${context.entityName}\nForm: ${context.formName}`); const toast=root.querySelector('.toast')!;toast.classList.add('on');setTimeout(()=>toast.classList.remove('on'),1200); });
  const tip = root.querySelector('.tip') as HTMLElement;
  for (const field of fields) {
    const nodes = document.querySelectorAll<HTMLElement>(`[data-id*="${CSS.escape(field.name)}"]`);
    nodes.forEach(node => {
      if (field.dirty) { node.style.outline = '2px solid #f59e0b'; node.style.outlineOffset = '2px'; }
      node.addEventListener('pointerenter', event => { tip.innerHTML=`<b>${escapeHtml(field.schema)}</b><span>Logical: ${escapeHtml(field.name)} · ${escapeHtml(field.type)} · ${escapeHtml(field.required)}${field.dirty?' · modified':''}</span>`;tip.style.display='block';tip.style.left=`${(event as PointerEvent).clientX+12}px`;tip.style.top=`${(event as PointerEvent).clientY+12}px`; });
      node.addEventListener('pointerleave', () => { tip.style.display='none'; });
    });
  }
  return { root, palette: root.querySelector('.palette')! };
}

export default defineContentScript({
  matches: ['https://*.dynamics.com/*'], allFrames: true,
  async main(ctx) {
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(tokenBytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const bridge = createBridge(token);
    ctx.onInvalidated(() => bridge.teardown());
    let context: CrmContext;
    try {
      await bridge.handshake();
      context = await bridge.call('context', null);
    } catch {
      bridge.teardown();
      return;
    }
    const fields = await bridge.call('fields', null).catch(() => []);
    const ui = installUi(context, fields);
    await browser.runtime.sendMessage({ type: 'REGISTER_CONTEXT', context } satisfies ToolMessage).catch(() => undefined);
    browser.runtime.onMessage.addListener(async (message: ToolMessage) => {
      if (message.type === 'GET_CONTEXT') return context;
      if (message.type === 'OPEN_PALETTE') { ui?.palette.classList.add('open'); (ui?.root.querySelector('input') as HTMLInputElement)?.focus(); }
      if (message.type === 'TOGGLE_THEME') document.documentElement.style.filter = message.enabled ? 'invert(.88) hue-rotate(180deg)' : '';
    });
  },
});
