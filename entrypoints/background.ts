import type { CrmContext, FrameRegistration, PerformanceSnapshot, ToolMessage } from '../shared/types';

interface CachedContext extends FrameRegistration {
  frameId: number;
  context: CrmContext;
}

const SESSION_KEY_PREFIX = 'dynamics-context:';

function sessionKey(tabId: number) {
  return `${SESSION_KEY_PREFIX}${tabId}`;
}

function isRecordContext(value: unknown): value is CrmContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<CrmContext>;
  return context.connected === true
    && typeof context.entityName === 'string' && context.entityName.length > 0
    && typeof context.recordId === 'string' && context.recordId.length > 0;
}

function contextQuality(context: CrmContext) {
  return [context.orgUrl, context.orgName, context.entityName, context.entityDisplayName,
    context.recordId, context.recordName, context.formName, context.formId, context.appId,
    context.appUniqueName].reduce<number>((score, value) => score + (typeof value === 'string' && value.length > 0 ? 1 : 0), 0)
    + (context.formType !== undefined ? 1 : 0);
}

function quality(target: CachedContext) {
  // Re-evaluate the context in the worker; registration quality is only a
  // tie-breaker and cannot make an incomplete context outrank a record form.
  return contextQuality(target.context) * 100 + Math.min(target.quality, 99);
}

function isCachedContext(value: unknown): value is CachedContext {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CachedContext>;
  return Number.isInteger(candidate.frameId) && (candidate.frameId ?? -1) >= 0
    && candidate.role === 'record'
    && typeof candidate.quality === 'number' && Number.isFinite(candidate.quality) && candidate.quality >= 0
    && typeof candidate.timestamp === 'number' && Number.isFinite(candidate.timestamp) && candidate.timestamp >= 0
    && isRecordContext(candidate.context);
}

export default defineBackground(() => {
  const contexts = new Map<number, CachedContext>();
  const performance = new Map<number, PerformanceSnapshot>();

  async function forgetTarget(tabId: number) {
    contexts.delete(tabId);
    await browser.storage.session.remove(sessionKey(tabId)).catch(() => undefined);
  }

  async function rememberTarget(tabId: number, target: CachedContext) {
    await browser.storage.session.set({ [sessionKey(tabId)]: target }).catch(() => undefined);
    // A write started just before tabs.onRemoved must not recreate its entry.
    if (contexts.get(tabId) !== target) {
      await browser.storage.session.remove(sessionKey(tabId)).catch(() => undefined);
    }
  }

  async function targetFor(tabId: number): Promise<CachedContext | undefined> {
    const inMemory = contexts.get(tabId);
    if (inMemory) return inMemory;

    const stored: Record<string, unknown> = await browser.storage.session.get(sessionKey(tabId)).catch(() => ({}));
    const restored = stored[sessionKey(tabId)];
    if (!isCachedContext(restored)) {
      if (restored !== undefined) await forgetTarget(tabId);
      return undefined;
    }

    // A session entry can outlive a frame navigation. Do not restore it until
    // the exact frame proves that it still hosts a record bridge.
    const context = await browser.tabs.sendMessage(
      tabId,
      { type: 'GET_CONTEXT' } satisfies ToolMessage,
      { frameId: restored.frameId },
    ).catch(() => undefined);
    if (!isRecordContext(context)) {
      await forgetTarget(tabId);
      return undefined;
    }

    const verified = { ...restored, context };
    contexts.set(tabId, verified);
    await rememberTarget(tabId, verified);
    return verified;
  }

  browser.runtime.onMessage.addListener((message: ToolMessage, sender) => {
    if (message.type === 'REGISTER_CONTEXT' && sender.tab?.id != null) {
      if (!isRecordContext(message.context)
        || message.frame.role !== 'record'
        || !Number.isFinite(message.frame.quality) || message.frame.quality < 0
        || !Number.isFinite(message.frame.timestamp) || message.frame.timestamp < 0
        || message.frame.timestamp > Date.now() + 60_000) {
        return Promise.resolve({ ok: false });
      }
      const tabId = sender.tab.id;
      // frameId comes exclusively from the browser sender metadata. It is not
      // part of FrameRegistration, so page-controlled message data cannot spoof it.
      const incoming: CachedContext = { frameId: sender.frameId ?? 0, ...message.frame, context: message.context };
      const current = contexts.get(tabId);
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
        const target = await targetFor(tab.id);
        return browser.tabs.sendMessage(tab.id, { type: 'GET_CONTEXT' } satisfies ToolMessage, target ? { frameId: target.frameId } : undefined)
          .catch(() => target?.context);
      });
    }
    if (message.type === 'CAPTURE_VISIBLE_TAB') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.windowId == null) throw new Error('No active tab to capture');
        return browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      });
    }
    if (message.type === 'RUN_REQUEST' || message.type === 'CANCEL_REQUEST' || message.type === 'GET_RELATIONSHIPS') {
      return browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (tab?.id == null) throw new Error('No active Dynamics tab');
        const target = await targetFor(tab.id);
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

  browser.tabs.onRemoved.addListener(tabId => {
    performance.delete(tabId);
    void forgetTarget(tabId);
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
