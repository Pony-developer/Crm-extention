import type { CrmContext, ToolMessage } from '../shared/types';

type FieldInfo = { name: string; schema: string; type: string; required: string; dirty: boolean };
const CHANNEL = 'dynamics-toolkit';
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

function setStyle(id: string, css: string) {
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) { style?.remove(); return; }
  if (!style) { style = document.createElement('style'); style.id = id; (document.head || document.documentElement).append(style); }
  style.textContent = css;
}

function applyAppearance(themeEnabled: boolean, customCssEnabled: boolean, customCss: string) {
  setStyle(THEME_STYLE_ID, themeEnabled && !/\/webresources?\//i.test(location.pathname) ? UCI_THEME_CSS : '');
  setStyle(CUSTOM_STYLE_ID, customCssEnabled ? customCss : '');
}

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
  async main() {
    const stored = await browser.storage.local.get(['themeEnabled', 'customCssEnabled', 'customCss']);
    let themeEnabled = Boolean(stored.themeEnabled);
    let customCssEnabled = Boolean(stored.customCssEnabled);
    let customCss = typeof stored.customCss === 'string' ? stored.customCss : '';
    applyAppearance(themeEnabled, customCssEnabled, customCss);
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.themeEnabled) themeEnabled = Boolean(changes.themeEnabled.newValue);
      if (changes.customCssEnabled) customCssEnabled = Boolean(changes.customCssEnabled.newValue);
      if (changes.customCss) customCss = typeof changes.customCss.newValue === 'string' ? changes.customCss.newValue : '';
      applyAppearance(themeEnabled, customCssEnabled, customCss);
    });
    let context: CrmContext;
    try { context = await callPage<CrmContext>('context'); } catch { return; }
    const fields = await callPage<FieldInfo[]>('fields').catch(() => []);
    const ui = installUi(context, fields);
    await browser.runtime.sendMessage({ type: 'REGISTER_CONTEXT', context } satisfies ToolMessage).catch(() => undefined);
    browser.runtime.onMessage.addListener(async (message: ToolMessage) => {
      if (message.type === 'GET_CONTEXT') return context;
      if (message.type === 'OPEN_PALETTE') { ui?.palette.classList.add('open'); (ui?.root.querySelector('input') as HTMLInputElement)?.focus(); }
      if (message.type === 'TOGGLE_THEME') { themeEnabled = message.enabled; applyAppearance(themeEnabled, customCssEnabled, customCss); }
    });
  },
});
