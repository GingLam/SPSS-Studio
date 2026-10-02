import type { AiStrings } from '../ai/aiStrings';
import type { AiResponseLanguage } from '../ai/chatProtocol';
import type { ConversationSummary } from '../ai/conversation';
import type { AssistantContentSegment } from '../ai/fencedCode';
import { safeMarkdownUrl } from '../ai/markdown';
import type { ModelProfileDraft, ModelProfileState } from '../ai/modelProfile';
import {
  isAiProviderId,
  type AiProviderId,
  type AiProviderPreset,
} from '../ai/providerPresets';

export type AiPage = 'chat' | 'history' | 'profiles';

export interface AiDisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  createdAt: string;
  profileName?: string;
  content?: string;
  segments?: AssistantContentSegment[];
}

export interface AiDisplayConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  truncated: boolean;
  messages: AiDisplayMessage[];
}

export interface AiViewRenderState {
  busy: boolean;
  responseLanguage: AiResponseLanguage;
  profiles: ModelProfileState;
  history: ConversationSummary[];
  currentConversation?: AiDisplayConversation;
}

export type ExtensionToAiWebviewMessage =
  | {
    type: 'renderState';
    composerHeight: number;
    presets: AiProviderPreset[];
    state: AiViewRenderState;
    strings: AiStrings;
  }
  | { type: 'showPage'; page: AiPage }
  | { type: 'responseStarted'; question: string }
  | { type: 'responseDelta'; content: string }
  | { type: 'requestFailed'; message: string; cancelled: boolean; question: string }
  | { type: 'operationMessage'; message: string; error: boolean };

interface ProfileFields {
  name?: string;
  providerId: AiProviderId;
  baseUrl: string;
  model: string;
  reasoningEnabled: boolean;
  apiKey?: string;
}

export type AiWebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'sendQuestion'; question: string }
  | { type: 'stop' }
  | { type: 'newChat' }
  | { type: 'openConversation'; conversationId: string }
  | { type: 'renameConversation'; conversationId: string; title: string }
  | { type: 'deleteConversation'; conversationId: string }
  | { type: 'clearAllConversations' }
  | { type: 'selectProfile'; profileId: string }
  | ({ type: 'createProfile' } & ProfileFields)
  | ({ type: 'saveProfile'; profileId: string } & ProfileFields)
  | { type: 'duplicateProfile'; profileId: string }
  | { type: 'deleteProfile'; profileId: string }
  | { type: 'deleteProfileKey'; profileId: string }
  | { type: 'openProviderHelp'; providerId: AiProviderId }
  | { type: 'openLink'; url: string }
  | { type: 'setComposerHeight'; height: number }
  | { type: 'setResponseLanguage'; language: AiResponseLanguage }
  | { type: 'insertCode'; code: string }
  | { type: 'copyCode'; code: string };

export function isAiWebviewMessage(value: unknown): value is AiWebviewToExtensionMessage {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    return false;
  }
  if (
    value.type === 'ready'
    || value.type === 'stop'
    || value.type === 'newChat'
    || value.type === 'clearAllConversations'
  ) {
    return true;
  }
  if (value.type === 'sendQuestion') {
    return boundedString(value.question, 1, 100_000);
  }
  if (value.type === 'insertCode' || value.type === 'copyCode') {
    return boundedString(value.code, 0, 500_000);
  }
  if (value.type === 'setComposerHeight') {
    return typeof value.height === 'number'
      && Number.isFinite(value.height)
      && value.height >= 72
      && value.height <= 2_000;
  }
  if (value.type === 'setResponseLanguage') {
    return value.language === 'zh-CN' || value.language === 'en';
  }
  if (value.type === 'openConversation' || value.type === 'deleteConversation') {
    return boundedString(value.conversationId, 1, 128);
  }
  if (value.type === 'renameConversation') {
    return boundedString(value.conversationId, 1, 128) && boundedString(value.title, 1, 200);
  }
  if (
    value.type === 'selectProfile'
    || value.type === 'duplicateProfile'
    || value.type === 'deleteProfile'
    || value.type === 'deleteProfileKey'
  ) {
    return boundedString(value.profileId, 1, 128);
  }
  if (value.type === 'openProviderHelp') {
    return isAiProviderId(value.providerId);
  }
  if (value.type === 'openLink') {
    return boundedString(value.url, 1, 4_096) && safeMarkdownUrl(value.url) !== undefined;
  }
  if (value.type === 'createProfile') {
    return validProfileFields(value);
  }
  if (value.type === 'saveProfile') {
    return boundedString(value.profileId, 1, 128) && validProfileFields(value);
  }
  return false;
}

export function profileDraftFromMessage(
  message: Extract<AiWebviewToExtensionMessage, { type: 'createProfile' | 'saveProfile' }>,
): ModelProfileDraft {
  return {
    providerId: message.providerId,
    baseUrl: message.baseUrl,
    model: message.model,
    reasoningEnabled: message.reasoningEnabled,
    ...(message.name === undefined ? {} : { name: message.name }),
  };
}

function validProfileFields(value: Record<string, unknown>): boolean {
  return (value.name === undefined || boundedString(value.name, 0, 120))
    && isAiProviderId(value.providerId)
    && boundedString(value.baseUrl, 1, 4_096)
    && boundedString(value.model, 1, 1_024)
    && typeof value.reasoningEnabled === 'boolean'
    && (value.apiKey === undefined || boundedString(value.apiKey, 0, 16_384));
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length >= minimum && value.length <= maximum;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
