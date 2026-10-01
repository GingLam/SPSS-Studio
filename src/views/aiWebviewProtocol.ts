import type { AiChatRole } from '../ai/chatProtocol';
import type { AssistantContentSegment } from '../ai/fencedCode';
import {
  isAiProviderId,
  type AiProviderConfiguration,
  type AiProviderId,
  type AiProviderPreset,
} from '../ai/providerPresets';
import type { ProviderConfigurationState } from '../ai/providerConfigurationStore';

export interface AiDisplayMessage {
  role: AiChatRole;
  content?: string;
  segments?: AssistantContentSegment[];
}

export type ExtensionToAiWebviewMessage =
  | {
    type: 'initialize';
    presets: AiProviderPreset[];
    state: ProviderConfigurationState;
    history: AiDisplayMessage[];
  }
  | { type: 'configurationState'; state: ProviderConfigurationState }
  | { type: 'configurationError'; message: string }
  | { type: 'showConfiguration' }
  | { type: 'appendUser'; content: string }
  | { type: 'responseStarted' }
  | { type: 'responseDelta'; content: string }
  | { type: 'responseCompleted'; segments: AssistantContentSegment[] }
  | { type: 'responseFailed'; message: string; cancelled: boolean }
  | { type: 'conversationCleared' };

export type AiWebviewToExtensionMessage =
  | { type: 'sendQuestion'; question: string }
  | { type: 'stop' }
  | { type: 'clear' }
  | { type: 'insertCode'; code: string }
  | { type: 'copyCode'; code: string }
  | {
    type: 'saveConfiguration';
    providerId: AiProviderId;
    baseUrl: string;
    model: string;
    apiKey?: string;
  }
  | { type: 'deleteApiKey'; providerId: AiProviderId }
  | { type: 'openProviderHelp'; providerId: AiProviderId };

export function isAiWebviewMessage(value: unknown): value is AiWebviewToExtensionMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  if (message.type === 'stop' || message.type === 'clear') {
    return true;
  }
  if (message.type === 'sendQuestion') {
    return boundedString(message.question, 1, 100_000);
  }
  if (message.type === 'insertCode' || message.type === 'copyCode') {
    return boundedString(message.code, 0, 500_000);
  }
  if (message.type === 'deleteApiKey' || message.type === 'openProviderHelp') {
    return isAiProviderId(message.providerId);
  }
  if (message.type !== 'saveConfiguration' || !isAiProviderId(message.providerId)) {
    return false;
  }
  return boundedString(message.baseUrl, 1, 4_096)
    && boundedString(message.model, 1, 1_024)
    && (message.apiKey === undefined || boundedString(message.apiKey, 0, 16_384));
}

export function configurationFromMessage(
  message: Extract<AiWebviewToExtensionMessage, { type: 'saveConfiguration' }>,
): AiProviderConfiguration {
  return {
    providerId: message.providerId,
    baseUrl: message.baseUrl,
    model: message.model,
  };
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length >= minimum && value.length <= maximum;
}
