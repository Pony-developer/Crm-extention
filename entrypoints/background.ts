import type { CrmContext, FrameRegistration, PerformanceSnapshot, ToolMessage } from '../shared/types';
import { NOT_HANDLED, createMessageListener, sendRuntimeMessage, sendTabMessage } from '../shared/messaging';

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
  const requestRoutes = new Map<string, { tabId: number; frameId: number }>();
  const pendingRequests = new Set<string>();
  const cancelledBeforeDispatch = new Set<string>();

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
    const context = await sendTabMessage<CrmContext | undefined>(
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

  async function activeTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function openPalette() {
    const tab = await activeTab();
    if (tab?.id == null) return false;
    const target = await targetFor(tab.id);
    // Without a verified record frame (for example after the worker restarted) ask every frame instead;
    // frames that do not host a record form stay silent, so only the right one answers.
    const opened = await sendTabMessage<boolean>(tab.id, { type: 'OPEN_PALETTE' } satisfies ToolMessage, target ? { frameId: target.frameId } : undefined).catch(() => false);
    return opened === true;
  }

  function notifyContextChanged(tabId: number, context?: CrmContext) {
    // The side panel may be closed; nobody listening is not an error.
    void sendRuntimeMessage({ type: 'ACTIVE_CONTEXT_CHANGED', tabId, context } satisfies ToolMessage).catch(() => undefined);
  }

  browser.runtime.onMessage.addListener(createMessageListener((message, sender) => {
    if (message.type === 'REGISTER_CONTEXT' && sender.tab?.id != null) {
      if (!isRecordContext(message.context)
        || message.frame.role !== 'record'
        || !Number.isFinite(message.frame.quality) || message.frame.quality < 0
        || !Number.isFinite(message.frame.timestamp) || message.frame.timestamp < 0
        || message.frame.timestamp > Date.now() + 60_000) {
        return { ok: false };
      }
      const tabId = sender.tab.id;
      // frameId comes exclusively from the browser sender metadata. It is not
      // part of FrameRegistration, so page-controlled message data cannot spoof it.
      const incoming: CachedContext = { frameId: sender.frameId ?? 0, ...message.frame, context: message.context };
      const current = contexts.get(tabId);
      // Embedded iframes can expose the same Xrm object. While the top frame owns the form, they never take over.
      if (current?.frameId === 0 && incoming.frameId !== 0) return { ok: true };
      // Registrations happen when a form context changes. A newer form must
      // replace an older frame even when it exposes fewer context fields.
      if (!current || incoming.timestamp > current.timestamp
        || (incoming.timestamp === current.timestamp
          && (current.frameId === incoming.frameId || quality(incoming) > quality(current)))) {
        contexts.set(tabId, incoming);
        void rememberTarget(tabId, incoming);
        notifyContextChanged(tabId, incoming.context);
      }
      return { ok: true };
    }
    if (message.type === 'CLEAR_CONTEXT' && sender.tab?.id != null) {
      // The record frame left its form, for example by in-app navigation to a grid.
      const tabId = sender.tab.id;
      const current = contexts.get(tabId);
      if (current && current.frameId === (sender.frameId ?? 0)) {
        return forgetTarget(tabId).then(() => { notifyContextChanged(tabId); return { ok: true }; });
      }
      return { ok: true };
    }
    if (message.type === 'REGISTER_PERFORMANCE' && sender.tab?.id != null) {
      performance.set(sender.tab.id, message.snapshot);
      void sendRuntimeMessage({ type: 'REGISTER_PERFORMANCE', snapshot: message.snapshot } satisfies ToolMessage).catch(() => undefined);
      return { ok: true };
    }
    if (message.type === 'GET_ACTIVE_CONTEXT') {
      return activeTab().then(async tab => {
        if (tab?.id == null) return undefined;
        const target = await targetFor(tab.id);
        return sendTabMessage(tab.id, { type: 'GET_CONTEXT' } satisfies ToolMessage, target ? { frameId: target.frameId } : undefined)
          .catch(() => undefined);
      });
    }
    if (message.type === 'OPEN_PALETTE' && sender.tab?.id == null) {
      // Sent by the side panel; content scripts only ever receive this message.
      return openPalette();
    }
    if (message.type === 'CAPTURE_VISIBLE_TAB') {
      return activeTab().then(tab => {
        if (tab?.windowId == null) throw new Error('No active tab to capture');
        return browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      });
    }
    if (message.type === 'RUN_REQUEST') {
      const requestId = message.request.requestId;
      pendingRequests.add(requestId);
      return browser.tabs.get(message.targetTabId).then(async tab => {
        if (!tab.active || tab.id == null) throw new Error('The active Dynamics tab changed. Reopen the Toolkit before running this request.');
        const target = await targetFor(tab.id);
        if (!target) throw new Error('Dynamics bridge is not connected to the selected tab');
        const context = await sendTabMessage<CrmContext | undefined>(tab.id, { type: 'GET_CONTEXT' } satisfies ToolMessage, { frameId: target.frameId }).catch(() => undefined);
        if (!isRecordContext(context)
          || context.orgUrl !== message.expectedContext.orgUrl
          || context.entityName !== message.expectedContext.entityName
          || context.recordId !== message.expectedContext.recordId) {
          throw new Error('The Dynamics record changed. Reopen the Toolkit before running this request.');
        }
        if (cancelledBeforeDispatch.has(requestId)) throw new Error('Request cancelled.');
        const route = { tabId: tab.id, frameId: target.frameId };
        requestRoutes.set(requestId, route);
        return sendTabMessage(tab.id, message, { frameId: target.frameId });
      }).finally(() => {
        pendingRequests.delete(requestId);
        cancelledBeforeDispatch.delete(requestId);
        requestRoutes.delete(requestId);
      });
    }
    if (message.type === 'CANCEL_REQUEST') {
      const route = requestRoutes.get(message.requestId);
      if (route) return sendTabMessage(route.tabId, message, { frameId: route.frameId }).catch(() => false);
      if (pendingRequests.has(message.requestId)) {
        cancelledBeforeDispatch.add(message.requestId);
        return true;
      }
      return false;
    }
    if (message.type === 'GET_RELATIONSHIPS' || message.type === 'OPEN_COMPONENT') {
      return activeTab().then(async tab => {
        if (tab?.id == null) throw new Error('No active Dynamics tab');
        const target = await targetFor(tab.id);
        if (!target) throw new Error('Dynamics bridge is not connected to the active tab');
        return sendTabMessage(tab.id, message, { frameId: target.frameId });
      });
    }
    if (message.type === 'GET_ACTIVE_PERFORMANCE') {
      return activeTab().then(tab => tab?.id != null ? performance.get(tab.id) : undefined);
    }
    if (message.type === 'SET_THEME') {
      return activeTab().then(async tab => {
        if (tab?.id == null) return;
        const target = await targetFor(tab.id);
        return sendTabMessage(tab.id, { type: 'TOGGLE_THEME', enabled: message.enabled } satisfies ToolMessage, target ? { frameId: target.frameId } : undefined);
      });
    }
    return NOT_HANDLED;
  }));

  browser.tabs.onRemoved.addListener(tabId => {
    performance.delete(tabId);
    void forgetTarget(tabId);
  });
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.windowId) await browser.sidePanel.open({ windowId: tab.windowId });
  });
  browser.commands.onCommand.addListener(async (command) => {
    if (command === 'open-command-palette') await openPalette();
  });
});
