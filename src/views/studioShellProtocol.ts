import {
  isAiWebviewMessage,
  type AiWebviewToExtensionMessage,
  type ExtensionToAiWebviewMessage,
} from './aiWebviewProtocol';
import {
  isWebviewMessage,
  type ExtensionToWebviewMessage,
  type WebviewToExtensionMessage,
} from './webviewProtocol';

export type StudioTab = 'output' | 'data' | 'variables' | 'ai';

export type StudioShellToExtensionMessage =
  | { scope: 'shell'; type: 'ready' }
  | { scope: 'studio'; message: WebviewToExtensionMessage }
  | { scope: 'ai'; message: AiWebviewToExtensionMessage };

export type ExtensionToStudioShellMessage =
  | { scope: 'studio'; message: ExtensionToWebviewMessage }
  | { scope: 'ai'; message: ExtensionToAiWebviewMessage };

export function isStudioShellMessage(value: unknown): value is StudioShellToExtensionMessage {
  if (!isPlainObject(value) || typeof value.scope !== 'string') {
    return false;
  }
  if (value.scope === 'shell') {
    return value.type === 'ready';
  }
  if (!('message' in value)) {
    return false;
  }
  if (value.scope === 'studio') {
    return isWebviewMessage(value.message);
  }
  if (value.scope === 'ai') {
    return isAiWebviewMessage(value.message);
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
