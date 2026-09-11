import type { CrmContext, PerformanceSnapshot, ToolMessage } from '../shared/types';

export default defineBackground(() => {
  const contexts = new Map<number, { frameId: number; context: CrmContext }>();
  const performance = new Map<number, PerformanceSnapshot>();

  browser.runtime.onMessage.addListener((message: ToolMessage, sender) => {
    if (message.type === 'REGISTER_CONTEXT' && sender.tab?.id != null) {
      contexts.set(sender.tab.id, { frameId: sender.frameId ?? 0, context: message.context });
      return Promise.resolve({ ok: true });
    }
    if (message.type === 'REGISTER_PERFORMANCE' && sender.tab?.id != null) {
      performance.set(sender.tab.id, message.snapshot);
      void browser.runtime.sendMessage({ type: 'REGISTER_PERFORMANCE', snapshot: message.snapshot } satisfies ToolMessage).catch(() => undefined);
      return Promise.resolve({ ok: true });
    }
    if (message.type === 'GET_ACTIVE_CONTEXT') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.id != null ? contexts.get(tab.id)?.context : undefined);
    }
    if (message.type === 'GET_ACTIVE_PERFORMANCE') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.id != null ? performance.get(tab.id) : undefined);
    }
    if (message.type === 'SET_THEME') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id == null) return;
        const target = contexts.get(tab.id);
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
      const target = contexts.get(tab.id);
      await browser.tabs.sendMessage(tab.id, { type: 'OPEN_PALETTE' } satisfies ToolMessage, target ? { frameId: target.frameId } : undefined).catch(() => undefined);
    }
  });
});
