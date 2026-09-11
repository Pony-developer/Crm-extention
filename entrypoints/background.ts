import type { ContextFrame, CrmContext, ToolMessage } from '../shared/types';

type ContextTarget = ContextFrame & { frameId: number };
type CachedContext = ContextTarget & { context: CrmContext };
const SESSION_KEY = 'contextFrames';

const isRecordContext = (context: unknown): context is CrmContext =>
  Boolean(context && typeof context === 'object' && (context as CrmContext).connected && (context as CrmContext).entityName);

const quality = ({ context, role }: CachedContext) =>
  (context.recordId ? 4 : 0) + (context.formName ? 2 : 0) + (role === 'embedded-entity-form' ? 1 : 0);

export default defineBackground(() => {
  const contexts = new Map<number, CachedContext>();

  async function sessionTargets(): Promise<Record<string, ContextTarget>> {
    const value: Record<string, unknown> = await browser.storage.session.get(SESSION_KEY).catch(() => ({}));
    return (value[SESSION_KEY] as Record<string, ContextTarget> | undefined) ?? {};
  }

  async function rememberTarget(tabId: number, target: ContextTarget) {
    const targets = await sessionTargets();
    targets[tabId] = target;
    await browser.storage.session.set({ [SESSION_KEY]: targets }).catch(() => undefined);
  }

  async function targetFor(tabId: number) {
    const cached = contexts.get(tabId);
    if (cached) return cached;
    return (await sessionTargets())[tabId];
  }

  async function queryContext(tabId: number): Promise<CrmContext | undefined> {
    const target = await targetFor(tabId);
    if (target) {
      const direct = await browser.tabs.sendMessage(tabId, { type: 'GET_CONTEXT' } satisfies ToolMessage, { frameId: target.frameId }).catch(() => undefined);
      if (isRecordContext(direct)) return direct;
    }

    // With no usable frame hint, let the browser ask every injected frame. Only
    // an entity-form content script answers GET_CONTEXT.
    const discovered = await browser.tabs.sendMessage(tabId, { type: 'GET_CONTEXT' } satisfies ToolMessage).catch(() => undefined);
    if (isRecordContext(discovered)) return discovered;
    return contexts.get(tabId)?.context;
  }

  browser.runtime.onMessage.addListener((message: ToolMessage, sender) => {
    if (message.type === 'REGISTER_CONTEXT' && sender.tab?.id != null) {
      if (!isRecordContext(message.context)) return Promise.resolve({ ok: false });
      const tabId = sender.tab.id;
      const incoming: CachedContext = { frameId: sender.frameId ?? 0, ...message.frame, context: message.context };
      const current = contexts.get(tabId);
      // Navigation in the registered frame always wins. Another (possibly late)
      // iframe may replace it only when it carries a more complete form context.
      if (!current || (current.frameId === incoming.frameId && incoming.timestamp >= current.timestamp) || quality(incoming) > quality(current)) {
        contexts.set(tabId, incoming);
        void rememberTarget(tabId, incoming);
      }
      return Promise.resolve({ ok: true });
    }
    if (message.type === 'GET_ACTIVE_CONTEXT') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.id != null ? queryContext(tab.id) : undefined);
    }
    if (message.type === 'SET_THEME') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (tab?.id == null) return;
        const target = await targetFor(tab.id);
        return browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_THEME', enabled: message.enabled } satisfies ToolMessage, target ? { frameId: target.frameId } : undefined);
      });
    }
  });

  browser.tabs.onRemoved.addListener(tabId => {
    contexts.delete(tabId);
    void sessionTargets().then(targets => { delete targets[tabId]; return browser.storage.session.set({ [SESSION_KEY]: targets }); }).catch(() => undefined);
  });
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.windowId) await browser.sidePanel.open({ windowId: tab.windowId });
  });
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'open-command-palette') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const target = await targetFor(tab.id);
      await browser.tabs.sendMessage(tab.id, { type: 'OPEN_PALETTE' } satisfies ToolMessage, target ? { frameId: target.frameId } : undefined).catch(() => undefined);
    }
  });
});
