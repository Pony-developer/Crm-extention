import { browser, type Browser } from 'wxt/browser';
import type { ToolMessage } from './types';

/**
 * Returning a Promise from a runtime.onMessage listener is only honoured by
 * recent Chrome versions, so replies go through sendResponse and are wrapped in
 * an envelope that carries errors across the message boundary.
 */
export const NOT_HANDLED = Symbol('not-handled');

type Reply = { dtReply: true; ok: true; value: unknown } | { dtReply: true; ok: false; error: string };

const isReply = (value: unknown): value is Reply =>
  Boolean(value) && typeof value === 'object' && (value as { dtReply?: unknown }).dtReply === true;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

type Handler = (message: ToolMessage, sender: Browser.runtime.MessageSender) => unknown;

/**
 * Wraps a handler into a runtime.onMessage listener. The handler returns a value
 * or a Promise to reply, or NOT_HANDLED to stay silent so another frame (or
 * listener) can answer instead of this one replying with `undefined`.
 */
export function createMessageListener(handler: Handler) {
  return (message: unknown, sender: Browser.runtime.MessageSender, sendResponse: (response: Reply) => void) => {
    if (!message || typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') return false;
    let result: unknown;
    try {
      result = handler(message as ToolMessage, sender);
    } catch (error) {
      sendResponse({ dtReply: true, ok: false, error: errorText(error) });
      return false;
    }
    if (result === NOT_HANDLED) return false;
    Promise.resolve(result).then(
      value => sendResponse({ dtReply: true, ok: true, value }),
      error => sendResponse({ dtReply: true, ok: false, error: errorText(error) }),
    );
    return true;
  };
}

function unwrap<T>(reply: unknown): T {
  if (!isReply(reply)) return reply as T;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value as T;
}

export async function sendRuntimeMessage<T = unknown>(message: ToolMessage): Promise<T> {
  return unwrap<T>(await browser.runtime.sendMessage(message));
}

export async function sendTabMessage<T = unknown>(tabId: number, message: ToolMessage, options?: { frameId?: number }): Promise<T> {
  return unwrap<T>(await browser.tabs.sendMessage(tabId, message, options));
}
