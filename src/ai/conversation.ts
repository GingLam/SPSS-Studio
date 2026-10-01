import type { AiProviderId } from './providerPresets';

export const CONVERSATION_SCHEMA_VERSION = 1;

export interface StoredConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  profileId?: string;
  profileName?: string;
  providerId?: AiProviderId;
  model?: string;
}

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastProfileId?: string;
  lastProfileName?: string;
  messages: StoredConversationMessage[];
  truncated?: boolean;
}

export interface ConversationFile {
  schemaVersion: typeof CONVERSATION_SCHEMA_VERSION;
  activeConversationId?: string;
  conversations: StoredConversation[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastProfileId?: string;
  lastProfileName?: string;
  questionCount: number;
  truncated: boolean;
}

export function emptyConversationFile(): ConversationFile {
  return { schemaVersion: CONVERSATION_SCHEMA_VERSION, conversations: [] };
}

export function conversationSummary(conversation: StoredConversation): ConversationSummary {
  const base = {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    questionCount: conversation.messages.filter((message) => message.role === 'user').length,
    truncated: conversation.truncated === true,
  };
  return {
    ...base,
    ...(conversation.lastProfileId === undefined ? {} : { lastProfileId: conversation.lastProfileId }),
    ...(conversation.lastProfileName === undefined ? {} : { lastProfileName: conversation.lastProfileName }),
  };
}

export function parseConversationFile(value: unknown): ConversationFile {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored AI conversation history is not an object.');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== CONVERSATION_SCHEMA_VERSION || !Array.isArray(candidate.conversations)) {
    throw new Error('Stored AI conversation history uses an unsupported format.');
  }
  const conversations = candidate.conversations.map(parseConversation);
  const ids = new Set(conversations.map((conversation) => conversation.id));
  if (ids.size !== conversations.length) {
    throw new Error('Stored AI conversation history contains duplicate ids.');
  }
  const activeConversationId = candidate.activeConversationId;
  if (
    activeConversationId !== undefined
    && (typeof activeConversationId !== 'string' || !ids.has(activeConversationId))
  ) {
    throw new Error('The active AI conversation is invalid.');
  }
  return activeConversationId === undefined
    ? { schemaVersion: CONVERSATION_SCHEMA_VERSION, conversations }
    : { schemaVersion: CONVERSATION_SCHEMA_VERSION, activeConversationId, conversations };
}

function parseConversation(value: unknown): StoredConversation {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored AI conversation is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isBoundedString(candidate.id, 1, 128)
    || !isBoundedString(candidate.title, 1, 200)
    || !isIsoDate(candidate.createdAt)
    || !isIsoDate(candidate.updatedAt)
    || !Array.isArray(candidate.messages)
  ) {
    throw new Error('Stored AI conversation is incomplete.');
  }
  const optionalStrings = ['lastProfileId', 'lastProfileName'] as const;
  for (const key of optionalStrings) {
    if (candidate[key] !== undefined && !isBoundedString(candidate[key], 1, 200)) {
      throw new Error(`Stored AI conversation ${key} is invalid.`);
    }
  }
  if (candidate.truncated !== undefined && typeof candidate.truncated !== 'boolean') {
    throw new Error('Stored AI conversation truncation state is invalid.');
  }
  return {
    id: candidate.id,
    title: candidate.title,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    messages: candidate.messages.map(parseMessage),
    ...(candidate.lastProfileId === undefined ? {} : { lastProfileId: candidate.lastProfileId as string }),
    ...(candidate.lastProfileName === undefined ? {} : { lastProfileName: candidate.lastProfileName as string }),
    ...(candidate.truncated === true ? { truncated: true } : {}),
  };
}

function parseMessage(value: unknown): StoredConversationMessage {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored AI conversation message is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isBoundedString(candidate.id, 1, 128)
    || (candidate.role !== 'user' && candidate.role !== 'assistant')
    || typeof candidate.content !== 'string'
    || !isIsoDate(candidate.createdAt)
  ) {
    throw new Error('Stored AI conversation message is incomplete.');
  }
  const optionalStrings = ['profileId', 'profileName', 'providerId', 'model'] as const;
  for (const key of optionalStrings) {
    if (candidate[key] !== undefined && !isBoundedString(candidate[key], 1, 1_024)) {
      throw new Error(`Stored AI conversation message ${key} is invalid.`);
    }
  }
  return {
    id: candidate.id,
    role: candidate.role,
    content: candidate.content,
    createdAt: candidate.createdAt,
    ...(candidate.profileId === undefined ? {} : { profileId: candidate.profileId as string }),
    ...(candidate.profileName === undefined ? {} : { profileName: candidate.profileName as string }),
    ...(candidate.providerId === undefined ? {} : { providerId: candidate.providerId as AiProviderId }),
    ...(candidate.model === undefined ? {} : { model: candidate.model as string }),
  };
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length >= minimum && value.length <= maximum;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
