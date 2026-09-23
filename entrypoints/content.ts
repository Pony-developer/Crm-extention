import type {
  ComponentSearchResult,
  CrmContext,
  FieldInfo,
  RelationshipsResult,
  AuthenticatedPageBridgeRequest,
  PageBridgeEvent,
  PageBridgeAction,
  PageBridgePayload,
  PageBridgeRequest,
  PageBridgeResult,
  PageBridgeResponse,
  PerformanceSnapshot,
  ToolMessage,
} from '../shared/types';

const CHANNEL = 'dynamics-toolkit' as const;
const THEME_STYLE_ID = 'dynamics-toolkit-theme';
const CUSTOM_STYLE_ID = 'dynamics-toolkit-custom-css';
const UCI_THEME_CSS = `
:root { --dt-page-bg:#111827; --dt-surface-bg:#182235; --dt-surface-raised:#202c40; --dt-border:#39475c; --dt-text:#eef2f7; --dt-text-muted:#b5c0cf; --dt-accent:#a68bfa; color-scheme:dark; }
body, #ApplicationShell, [data-id="app-shell"], [data-id="page-container"], [data-id="form-container"] { background-color:var(--dt-page-bg)!important; color:var(--dt-text)!important; }
[role="dialog"], [role="menu"], [role="listbox"], [data-id="command-bar"], [data-id="header-container"], [data-id="tab-section"], [data-id="section-container"], [data-id="grid-container"], .ms-Panel-main, .ms-Callout-main { background-color:var(--dt-surface-bg)!important; color:var(--dt-text)!important; border-color:var(--dt-border)!important; }
input:not([type="image"]), textarea, select, button, [role="textbox"], [role="combobox"], [role="gridcell"], [role="columnheader"] { color:var(--dt-text)!important; border-color:var(--dt-border)!important; }
input:not([type="image"]), textarea, select, [role="textbox"], [role="combobox"] { background-color:var(--dt-surface-raised)!important; }
a, [role="link"] { color:var(--dt-accent)!important; }
[class*="label"], [class*="Label"], [data-id*="field-label"] { color:var(--dt-text-muted)!important; }
img, picture, video, canvas, svg, iframe, object, embed, [data-id*="webresource" i], [class*="webresource" i] { color-scheme:normal; }
`;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

type BridgeAction = Exclude<PageBridgeAction, 'handshake'>;
type BridgePayload<A extends BridgeAction> = PageBridgePayload<A>;
type BridgeResult<A extends BridgeAction> = PageBridgeResult<A>;
type PendingRequest = { resolve(response: PageBridgeResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

function createPageBridge(token: string) {
  const pending = new Map<string, PendingRequest>();
  let tornDown = false;
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source !== window || event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
    const response = event.data as Partial<PageBridgeResponse>;
    if (response.channel !== CHANNEL || response.direction !== 'response' || typeof response.id !== 'string') return;
    if (response.action !== 'handshake' && response.token !== token) return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    request.resolve(response as PageBridgeResponse);
  };
  window.addEventListener('message', receive);

  const send = (request: PageBridgeRequest | AuthenticatedPageBridgeRequest<BridgeAction>, timeout: number) => new Promise<PageBridgeResponse>((resolve, reject) => {
    if (tornDown) return reject(new Error('Dynamics page bridge was torn down'));
    const timer = setTimeout(() => {
      pending.delete(request.id);
      reject(new Error(`Dynamics page bridge timed out (${request.action})`));
    }, timeout);
    pending.set(request.id, { resolve, reject, timer });
    window.postMessage(request, window.location.origin);
  });

  return {
    async handshake() {
      const response = await send({ channel: CHANNEL, direction: 'request', id: crypto.randomUUID(), action: 'handshake', payload: { token } }, 4_000);
      if ('error' in response) throw new Error(response.error);
      if (response.action !== 'handshake' || response.token !== token || !response.result.accepted) throw new Error('Invalid bridge handshake response');
    },
    async call<A extends BridgeAction>(action: A, payload: BridgePayload<A>, timeout = 10_000): Promise<BridgeResult<A>> {
      const request: AuthenticatedPageBridgeRequest<A> = { channel: CHANNEL, direction: 'request', id: crypto.randomUUID(), action, token, payload };
      const response = await send(request, timeout);
      if ('error' in response) throw new Error(response.error);
      if (response.action !== action) throw new Error('Bridge returned a mismatched action');
      return bridgeResult(action, response);
    },
    teardown() {
      if (tornDown) return;
      tornDown = true;
      window.removeEventListener('message', receive);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Dynamics page bridge was torn down'));
      }
      pending.clear();
    },
  };
}

const resultReaders: { [A in BridgeAction]: (response: PageBridgeResponse) => BridgeResult<A> } = {
  context: response => {
    if ('result' in response && response.action === 'context') return response.result;
    throw new Error('Bridge returned an invalid context result');
  },
  fields: response => {
    if ('result' in response && response.action === 'fields') return response.result;
    throw new Error('Bridge returned an invalid fields result');
  },
  request: response => {
    if ('result' in response && response.action === 'request') return response.result;
    throw new Error('Bridge returned an invalid request result');
  },
  cancelRequest: response => {
    if ('result' in response && response.action === 'cancelRequest') return response.result;
    throw new Error('Bridge returned an invalid cancellation result');
  },
  searchComponents: response => {
    if ('result' in response && response.action === 'searchComponents') return response.result;
    throw new Error('Bridge returned an invalid component search result');
  },
  getRelationships: response => {
    if ('result' in response && response.action === 'getRelationships') return response.result;
    throw new Error('Bridge returned an invalid relationships result');
  },
  openComponent: response => {
    if ('result' in response && response.action === 'openComponent') return response.result;
    throw new Error('Bridge returned an invalid component navigation result');
  },
};

function bridgeResult<A extends BridgeAction>(action: A, response: PageBridgeResponse): BridgeResult<A> {
  return resultReaders[action](response);
}

type PageBridge = ReturnType<typeof createPageBridge>;

function installUi(context: CrmContext, initialFields: FieldInfo[], bridge: PageBridge) {
  document.getElementById('dt-host')?.remove();
  const controller = new AbortController();
  const fields = new Map(initialFields.map(field => [field.name, { ...field }]));
  const decorated = new Map<HTMLElement, { field: string; enter: (event: PointerEvent) => void; leave: () => void }>();
  const host = document.createElement('div'); host.id = 'dt-host'; document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>:host{all:initial}.badge{position:fixed;right:18px;bottom:18px;z-index:2147483647;font:13px Segoe UI,sans-serif;background:#111927;color:#fff;border:1px solid #334155;border-radius:12px;padding:8px;display:flex;align-items:center;gap:9px;box-shadow:0 12px 30px #0004}.mark{height:27px;width:27px;border-radius:8px;background:#8155ff;display:grid;place-items:center;font-weight:800}.meta{max-width:190px}.meta>*{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.meta small{color:#9ca7b8}.copy{border:0;background:#243044;color:#dbe4f0;border-radius:7px;padding:7px;cursor:pointer}.toast,.tip{position:fixed;z-index:2147483647;background:#111927;color:#fff;border:1px solid #40506a;padding:9px 12px;border-radius:8px;font:12px Segoe UI;pointer-events:none}.toast{right:18px;bottom:82px;opacity:0;transition:.2s}.toast.on{opacity:1}.tip{display:none}.tip b,.tip span{display:block}.tip span{color:#aab6c9;margin-top:3px}.palette{display:none;position:fixed;inset:0;z-index:2147483646;background:#02061777;place-items:start center;padding-top:12vh;font:14px Segoe UI}.palette.open{display:grid}.panel{width:min(590px,88vw);border:1px solid #475569;background:#101827;border-radius:14px;color:white;overflow:hidden;box-shadow:0 24px 70px #0008}.search{display:flex;gap:12px;padding:17px;border-bottom:1px solid #263449}.search input{width:100%;background:none;border:0;outline:0;color:white;font-size:16px}.results{max-height:420px;overflow:auto;margin:0;padding:6px;list-style:none}.state{padding:16px;color:#aeb9ca}.item{display:flex;align-items:center;gap:12px;padding:11px;border-radius:8px;cursor:pointer}.item.selected,.item:hover{background:#27344a}.kind{font-size:10px;text-transform:uppercase;color:#bba7ff;background:#31265b;padding:4px 6px;border-radius:5px;white-space:nowrap}.item-text{min-width:0}.item b,.item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item small{color:#97a5ba;margin-top:3px}.dirty{outline:2px solid #f59e0b!important;outline-offset:2px}</style><div class="badge"><div class="mark">D</div><div class="meta"><b>${escapeHtml(context.recordName || context.entityName || 'Dynamics record')}</b><small>${escapeHtml([context.entityName, context.recordId?.slice(0,8), context.formName].filter(Boolean).join(' · '))}</small></div><button class="copy">Copy</button></div><div class="toast">Context copied</div><div class="tip"></div><div class="palette" role="dialog" aria-label="Dynamics component search"><div class="panel"><div class="search"><span>⌘K</span><input aria-label="Search Dynamics components" autocomplete="off" placeholder="Search tables, forms, views, plugin steps and flows…"/></div><ul class="results" role="listbox"><li class="state">Type a component name to search in Dynamics</li></ul></div></div>`;
  const tip = root.querySelector<HTMLElement>('.tip')!;
  const palette = root.querySelector<HTMLElement>('.palette')!;
  const input = root.querySelector<HTMLInputElement>('.search input')!;
  const list = root.querySelector<HTMLUListElement>('.results')!;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  root.querySelector<HTMLButtonElement>('.copy')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(`Record ID: ${context.recordId}\nEntity: ${context.entityName}\nForm: ${context.formName}`);
    const toast = root.querySelector<HTMLElement>('.toast')!;
    toast.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('on'), 1200);
  }, { signal: controller.signal });

  const positionTip = (event: PointerEvent) => {
    const bounds = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(event.clientX + 12, innerWidth - bounds.width - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(event.clientY + 12, innerHeight - bounds.height - 8))}px`;
  };
  const idsFor = (name: string) => [`${name}.fieldControl-text-box-text`, `${name}.fieldControl-option-set-select`, `${name}.fieldControl-date-time-input`, `${name}.fieldControl-checkbox-toggle`, `${name}.fieldControl-LookupResultsDropdown_${name}_textInputBox_with_filter_new`];
  const findControls = (field: FieldInfo) => {
    const controls = new Set<HTMLElement>();
    for (const name of field.controlNames) for (const id of idsFor(name)) {
      const candidate = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
      const control = candidate?.matches('input,textarea,select,button,[role="combobox"],[contenteditable="true"]') ? candidate : candidate?.querySelector<HTMLElement>('input,textarea,select,button,[role="combobox"],[contenteditable="true"]');
      if (control) controls.add(control);
    }
    return controls;
  };
  const updateMarks = () => {
    for (const [node, binding] of decorated) {
      const dirty = fields.get(binding.field)?.dirty;
      node.style.outline = dirty ? '2px solid #f59e0b' : '';
      node.style.outlineOffset = dirty ? '2px' : '';
    }
  };
  const scan = () => {
    for (const field of fields.values()) for (const node of findControls(field)) {
      if (decorated.has(node)) continue;
      const enter = (event: PointerEvent) => { const current = fields.get(field.name) ?? field; tip.innerHTML = `<b>${escapeHtml(current.schema)}</b><span>Logical: ${escapeHtml(current.name)} · ${escapeHtml(current.type)} · ${escapeHtml(current.required)}${current.dirty ? ' · modified' : ''}</span>`; tip.style.display = 'block'; positionTip(event); };
      const leave = () => { tip.style.display = 'none'; };
      node.addEventListener('pointerenter', enter); node.addEventListener('pointermove', positionTip); node.addEventListener('pointerleave', leave);
      decorated.set(node, { field: field.name, enter, leave });
    }
    for (const [node, binding] of decorated) if (!node.isConnected) { node.removeEventListener('pointerenter', binding.enter); node.removeEventListener('pointermove', positionTip); node.removeEventListener('pointerleave', binding.leave); decorated.delete(node); }
    updateMarks();
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true }); scan();

  let results: ComponentSearchResult[] = [];
  let selected = -1;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestNumber = 0;
  const state = (message: string) => { list.innerHTML = `<li class="state">${escapeHtml(message)}</li>`; };
  const render = () => { if (!results.length) return state('No matching components'); list.innerHTML = results.map((item, index) => `<li class="item${index === selected ? ' selected' : ''}" role="option" aria-selected="${index === selected}" data-index="${index}"><span class="kind">${escapeHtml(item.type.replace('-', ' '))}</span><span class="item-text"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.subtitle ?? '')}</small></span></li>`).join(''); list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }); };
  const open = async (index: number) => { const item = results[index]; if (!item) return; try { await bridge.call('openComponent', item); palette.classList.remove('open'); } catch (error) { state(error instanceof Error ? error.message : 'Could not open component'); } };
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer); selected = -1; const current = ++requestNumber; const query = input.value.trim();
    if (!query) { results = []; state('Type a component name to search in Dynamics'); return; }
    state('Searching…'); debounceTimer = setTimeout(async () => { try { const found = await bridge.call('searchComponents', { query, limit: 20 }); if (current !== requestNumber) return; results = found; selected = results.length ? 0 : -1; render(); } catch (error) { if (current === requestNumber) state(error instanceof Error ? error.message : 'Search failed'); } }, 300);
  }, { signal: controller.signal });
  input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); palette.classList.remove('open'); } else if (event.key === 'Enter') { event.preventDefault(); void open(selected); } else if (results.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); selected = event.key === 'ArrowDown' ? (selected + 1) % results.length : (selected - 1 + results.length) % results.length; render(); } }, { signal: controller.signal });
  list.addEventListener('mousemove', event => { const row = (event.target as Element).closest<HTMLElement>('[data-index]'); if (row && selected !== Number(row.dataset.index)) { selected = Number(row.dataset.index); render(); } }, { signal: controller.signal });
  list.addEventListener('click', event => { const row = (event.target as Element).closest<HTMLElement>('[data-index]'); if (row) void open(Number(row.dataset.index)); }, { signal: controller.signal });
  palette.addEventListener('mousedown', event => { if (event.target === palette) palette.classList.remove('open'); }, { signal: controller.signal });

  const cleanup = () => { observer.disconnect(); controller.abort(); clearTimeout(debounceTimer); clearTimeout(toastTimer); for (const [node, binding] of decorated) { node.removeEventListener('pointerenter', binding.enter); node.removeEventListener('pointermove', positionTip); node.removeEventListener('pointerleave', binding.leave); node.style.outline = ''; node.style.outlineOffset = ''; } decorated.clear(); host.remove(); };
  return {
    root, palette, cleanup,
    updateField(name: string, dirty: boolean) { const field = fields.get(name); if (field) field.dirty = dirty; updateMarks(); },
    applyFields(nextFields: FieldInfo[]) { fields.clear(); nextFields.forEach(field => fields.set(field.name, { ...field })); scan(); },
    updateFields(states: Array<{ name: string; dirty: boolean }>) { states.forEach(state => { const field = fields.get(state.name); if (field) field.dirty = state.dirty; }); updateMarks(); },
  };
}

function setStyle(id: string, css: string) { let style = document.querySelector<HTMLStyleElement>(`style#${id}`); if (!css) { style?.remove(); return; } if (!style) { style = document.createElement('style'); style.id = id; (document.head || document.documentElement).append(style); } style.textContent = css; }
function applyTheme(enabled: boolean) { setStyle(THEME_STYLE_ID, enabled ? UCI_THEME_CSS : ''); }
function applyCustomCss(enabled: boolean, css: string) { setStyle(CUSTOM_STYLE_ID, enabled ? css : ''); }

export default defineContentScript({
  matches: ['https://*.dynamics.com/*'], allFrames: true,
  async main(ctx) {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const bridge = createPageBridge(token);
    let current: { key: string; context: CrmContext; ui: ReturnType<typeof installUi> } | undefined;
    let stopped = false;
    let navigationTimer: number | undefined;
    const stored = await browser.storage.local.get(['themeEnabled', 'customCssEnabled', 'customCss']);
    let themeEnabled = Boolean(stored.themeEnabled), customCssEnabled = Boolean(stored.customCssEnabled), customCss = typeof stored.customCss === 'string' ? stored.customCss : '';
    applyTheme(themeEnabled);
    applyCustomCss(customCssEnabled, customCss);

    const initialize = async () => {
      const context = await bridge.call('context', null).catch(() => undefined);
      if (!context || stopped) return;
      const key = `${context.entityName ?? ''}:${context.recordId ?? ''}:${context.formId ?? ''}`;
      if (current?.key === key) return;
      const fields = await bridge.call('fields', null).catch(() => []);
      if (stopped) return;
      current?.ui.cleanup(); current = { key, context, ui: installUi(context, fields, bridge) };
      const quality = [context.orgUrl, context.entityName, context.recordId, context.formId, context.appId]
        .filter(value => typeof value === 'string' && value.length > 0).length;
      await browser.runtime.sendMessage({
        type: 'REGISTER_CONTEXT',
        context,
        frame: { role: 'record', quality, timestamp: Date.now() },
      } satisfies ToolMessage).catch(() => undefined);
    };
    const onPageEvent = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin || !event.data || typeof event.data !== 'object') return;
      const pageEvent = event.data as PageBridgeEvent;
      if (pageEvent.channel !== CHANNEL || pageEvent.direction !== 'event') return;
      if (pageEvent.event === 'attribute-change') current?.ui.updateField(pageEvent.payload.name, pageEvent.payload.dirty);
      else if (pageEvent.event === 'fields-state') current?.ui.updateFields(pageEvent.payload.fields);
    };
    const onPerformance = (event: MessageEvent<unknown>) => { const data = event.data as { channel?: string; direction?: string; snapshot?: PerformanceSnapshot }; if (event.source === window && data?.channel === CHANNEL && data.direction === 'performance' && data.snapshot) void browser.runtime.sendMessage({ type: 'REGISTER_PERFORMANCE', snapshot: data.snapshot } satisfies ToolMessage).catch(() => undefined); };
    const onRuntimeMessage = async (message: ToolMessage) => {
      if (message.type === 'GET_CONTEXT') return current?.context;
      if (message.type === 'RUN_REQUEST') {
        try {
          return await bridge.call('request', { ...message.request, expectedContext: message.expectedContext }, 120_000);
        } catch (error) {
          // A bridge timeout must not leave the page fetch running without a Stop route.
          void bridge.call('cancelRequest', { requestId: message.request.requestId }).catch(() => undefined);
          throw error;
        }
      }
      if (message.type === 'CANCEL_REQUEST') return bridge.call('cancelRequest', { requestId: message.requestId });
      if (message.type === 'GET_RELATIONSHIPS') return bridge.call('getRelationships', message.request, 120_000) satisfies Promise<RelationshipsResult>;
      if (message.type === 'OPEN_COMPONENT') return bridge.call('openComponent', message.component);
      if (message.type === 'OPEN_PALETTE') { current?.ui.palette.classList.add('open'); current?.ui.root.querySelector<HTMLInputElement>('input')?.focus(); }
      if (message.type === 'TOGGLE_THEME') { themeEnabled = message.enabled; applyTheme(themeEnabled); }
    };
    const onStorageChanged = (changes: Record<string, Browser.storage.StorageChange>, area: string) => { if (area !== 'local') return; if (changes.themeEnabled) { themeEnabled = Boolean(changes.themeEnabled.newValue); applyTheme(themeEnabled); } if (changes.customCssEnabled) customCssEnabled = Boolean(changes.customCssEnabled.newValue); if (changes.customCss) customCss = typeof changes.customCss.newValue === 'string' ? changes.customCss.newValue : ''; if (changes.customCssEnabled || changes.customCss) applyCustomCss(customCssEnabled, customCss); };
    const cleanup = () => { if (stopped) return; stopped = true; if (navigationTimer !== undefined) clearInterval(navigationTimer); window.removeEventListener('message', onPageEvent); window.removeEventListener('message', onPerformance); window.removeEventListener('pagehide', cleanup); browser.runtime.onMessage.removeListener(onRuntimeMessage); browser.storage.onChanged.removeListener(onStorageChanged); current?.ui.cleanup(); document.querySelector(`style#${THEME_STYLE_ID}`)?.remove(); document.querySelector(`style#${CUSTOM_STYLE_ID}`)?.remove(); bridge.teardown(); };
    ctx.onInvalidated(cleanup); window.addEventListener('message', onPageEvent); window.addEventListener('message', onPerformance); window.addEventListener('pagehide', cleanup, { once: true }); browser.runtime.onMessage.addListener(onRuntimeMessage); browser.storage.onChanged.addListener(onStorageChanged);
    try { await bridge.handshake(); } catch { cleanup(); return; }
    await initialize(); navigationTimer = window.setInterval(initialize, 1000);
  },
});
