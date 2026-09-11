import type { CrmContext, PerformanceSnapshot, ToolMessage } from '../shared/types';

export default defineBackground(() => {
  const contexts = new Map<number, { frameId: number; context: CrmContext }>();
  const performance = new Map<number, PerformanceSnapshot>();

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
    if (message.type === 'REGISTER_PERFORMANCE' && sender.tab?.id != null) {
      performance.set(sender.tab.id, message.snapshot);
      void browser.runtime.sendMessage({ type: 'REGISTER_PERFORMANCE', snapshot: message.snapshot } satisfies ToolMessage).catch(() => undefined);
      return Promise.resolve({ ok: true });
    }
    if (message.type === 'GET_ACTIVE_CONTEXT') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (tab?.id == null) return undefined;
        const target = contexts.get(tab.id);
        return browser.tabs.sendMessage(tab.id, { type: 'GET_CONTEXT' } satisfies ToolMessage, target ? { frameId: target.frameId } : undefined)
          .catch(() => target?.context);
      });
    }
    if (message.type === 'CAPTURE_VISIBLE_TAB') {
      // captureVisibleTab is deliberately kept in the worker. `activeTab` grants
      // access only after an explicit user action; no page or field data is read.
      return browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.windowId == null) throw new Error('No active tab to capture');
        return browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      });
    }
    if (message.type === 'RUN_REQUEST' || message.type === 'CANCEL_REQUEST') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id == null) throw new Error('No active Dynamics tab');
        const target = contexts.get(tab.id);
        if (!target) throw new Error('Dynamics bridge is not connected to the active tab');
        return browser.tabs.sendMessage(tab.id, message, { frameId: target.frameId });
      });
    }
    if (message.type === 'GET_ACTIVE_PERFORMANCE') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.id != null ? performance.get(tab.id) : undefined);
    }
    if (message.type === 'SET_THEME') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (tab?.id == null) return;
        const target = await targetFor(tab.id);
        return browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_THEME', enabled: message.enabled } satisfies ToolMessage, target ? { frameId: target.frameId } : undefined);
      });
    }
  });

  browser.tabs.onRemoved.addListener(tabId => { contexts.delete(tabId); performance.delete(tabId); });
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
