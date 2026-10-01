import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CONVERSATION_SCHEMA_VERSION,
  conversationSummary,
  emptyConversationFile,
  parseConversationFile,
  type ConversationFile,
  type ConversationSummary,
  type StoredConversation,
} from './conversation';

const HISTORY_FILENAME = 'history-v1.json';
const BACKUP_FILENAME = 'history-v1.backup.json';

interface ConversationStoreLimits {
  maxConversations: number;
  maxContentBytesPerConversation: number;
  maxMessagesPerConversation: number;
  maxTotalBytes: number;
}

interface ConversationStoreOptions extends Partial<ConversationStoreLimits> {
  now?: () => Date;
  onWarning?: (message: string) => void;
}

const DEFAULT_LIMITS: ConversationStoreLimits = {
  maxConversations: 100,
  maxContentBytesPerConversation: 512 * 1_024,
  maxMessagesPerConversation: 200,
  maxTotalBytes: 25 * 1_024 * 1_024,
};

export class ConversationStore {
  private data: ConversationFile | undefined;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly limits: ConversationStoreLimits;
  private readonly now: () => Date;
  private readonly onWarning: (message: string) => void;

  public constructor(
    private readonly storageDirectory: string,
    options: ConversationStoreOptions = {},
  ) {
    this.limits = {
      maxConversations: options.maxConversations ?? DEFAULT_LIMITS.maxConversations,
      maxContentBytesPerConversation: options.maxContentBytesPerConversation
        ?? DEFAULT_LIMITS.maxContentBytesPerConversation,
      maxMessagesPerConversation: options.maxMessagesPerConversation
        ?? DEFAULT_LIMITS.maxMessagesPerConversation,
      maxTotalBytes: options.maxTotalBytes ?? DEFAULT_LIMITS.maxTotalBytes,
    };
    this.now = options.now ?? (() => new Date());
    this.onWarning = options.onWarning ?? (() => undefined);
  }

  public async state(): Promise<ConversationFile> {
    await this.operationQueue;
    return structuredClone(await this.ensureLoaded());
  }

  public async summaries(): Promise<ConversationSummary[]> {
    const state = await this.state();
    return state.conversations
      .map(conversationSummary)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async get(conversationId: string): Promise<StoredConversation | undefined> {
    const state = await this.state();
    return state.conversations.find((conversation) => conversation.id === conversationId);
  }

  public save(conversation: StoredConversation, makeActive = true): Promise<void> {
    return this.enqueue(async () => {
      const data = structuredClone(await this.ensureLoaded());
      const index = data.conversations.findIndex((candidate) => candidate.id === conversation.id);
      if (index >= 0) {
        data.conversations[index] = structuredClone(conversation);
      } else {
        data.conversations.push(structuredClone(conversation));
      }
      if (makeActive) {
        data.activeConversationId = conversation.id;
      }
      this.data = this.applyLimits(data);
      await this.persist(this.data);
    });
  }

  public setActive(conversationId: string): Promise<void> {
    return this.enqueue(async () => {
      const data = structuredClone(await this.ensureLoaded());
      if (!data.conversations.some((conversation) => conversation.id === conversationId)) {
        throw new Error('The selected AI conversation no longer exists.');
      }
      data.activeConversationId = conversationId;
      this.data = data;
      await this.persist(data);
    });
  }

  public rename(conversationId: string, title: string): Promise<void> {
    return this.enqueue(async () => {
      const normalized = title.replace(/\s+/gu, ' ').trim();
      if (!normalized || normalized.length > 200) {
        throw new Error('The AI conversation title must contain 1 to 200 characters.');
      }
      const data = structuredClone(await this.ensureLoaded());
      const conversation = data.conversations.find((candidate) => candidate.id === conversationId);
      if (!conversation) {
        throw new Error('The selected AI conversation no longer exists.');
      }
      conversation.title = normalized;
      conversation.updatedAt = this.now().toISOString();
      this.data = this.applyLimits(data);
      await this.persist(this.data);
    });
  }

  public delete(conversationId: string): Promise<void> {
    return this.enqueue(async () => {
      const data = structuredClone(await this.ensureLoaded());
      const conversations = data.conversations.filter((conversation) => conversation.id !== conversationId);
      if (conversations.length === data.conversations.length) {
        throw new Error('The selected AI conversation no longer exists.');
      }
      const activeConversationId = data.activeConversationId === conversationId
        ? undefined
        : data.activeConversationId;
      this.data = activeConversationId === undefined
        ? { schemaVersion: CONVERSATION_SCHEMA_VERSION, conversations }
        : { schemaVersion: CONVERSATION_SCHEMA_VERSION, activeConversationId, conversations };
      await this.persist(this.data);
    });
  }

  public clear(): Promise<void> {
    return this.enqueue(async () => {
      this.data = emptyConversationFile();
      await this.persist(this.data);
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.catch(() => undefined);
    return result;
  }

  private async ensureLoaded(): Promise<ConversationFile> {
    if (this.data) {
      return this.data;
    }
    await fs.mkdir(this.storageDirectory, { recursive: true });
    const primaryPath = path.join(this.storageDirectory, HISTORY_FILENAME);
    const backupPath = path.join(this.storageDirectory, BACKUP_FILENAME);
    const primary = await this.readOptional(primaryPath);
    if (primary !== undefined) {
      try {
        this.data = parseConversationFile(JSON.parse(primary) as unknown);
        return this.data;
      } catch (error) {
        await this.preserveCorrupt(primaryPath, 'primary');
        this.onWarning(`The SPSS AI history file is invalid: ${this.errorMessage(error)}`);
      }
    }

    const backup = await this.readOptional(backupPath);
    if (backup !== undefined) {
      try {
        this.data = parseConversationFile(JSON.parse(backup) as unknown);
        await fs.writeFile(primaryPath, backup, 'utf8');
        this.onWarning('SPSS AI history was restored from its last-known-good backup.');
        return this.data;
      } catch (error) {
        await this.preserveCorrupt(backupPath, 'backup');
        this.onWarning(`The SPSS AI history backup is invalid: ${this.errorMessage(error)}`);
      }
    }

    this.data = emptyConversationFile();
    return this.data;
  }

  private applyLimits(value: ConversationFile): ConversationFile {
    let conversations = value.conversations.map((conversation) => this.limitConversation(conversation));
    conversations.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    conversations = conversations.slice(0, this.limits.maxConversations);
    while (conversations.length > 0 && this.serializedSize({
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      conversations,
    }) > this.limits.maxTotalBytes) {
      conversations.pop();
    }
    const activeConversationId = value.activeConversationId;
    const activeExists = activeConversationId !== undefined
      && conversations.some((conversation) => conversation.id === activeConversationId);
    return activeExists
      ? { schemaVersion: CONVERSATION_SCHEMA_VERSION, activeConversationId, conversations }
      : { schemaVersion: CONVERSATION_SCHEMA_VERSION, conversations };
  }

  private limitConversation(value: StoredConversation): StoredConversation {
    const conversation = structuredClone(value);
    let removed = false;
    const contentSize = (): number => conversation.messages.reduce(
      (total, message) => total + Buffer.byteLength(message.content, 'utf8'),
      0,
    );
    while (
      conversation.messages.length > 2
      && (
        conversation.messages.length > this.limits.maxMessagesPerConversation
        || contentSize() > this.limits.maxContentBytesPerConversation
      )
    ) {
      const pairLength = conversation.messages[0]?.role === 'user'
        && conversation.messages[1]?.role === 'assistant'
        ? 2
        : 1;
      conversation.messages.splice(0, pairLength);
      removed = true;
    }
    if (
      conversation.messages.length > this.limits.maxMessagesPerConversation
      || contentSize() > this.limits.maxContentBytesPerConversation
    ) {
      throw new Error('The latest AI conversation turn exceeds the local history storage limit.');
    }
    if (removed || value.truncated === true) {
      conversation.truncated = true;
    }
    return conversation;
  }

  private async persist(value: ConversationFile): Promise<void> {
    const validated = parseConversationFile(structuredClone(value));
    const serialized = `${JSON.stringify(validated, undefined, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > this.limits.maxTotalBytes) {
      throw new Error('SPSS AI history exceeds the local storage limit.');
    }
    await fs.mkdir(this.storageDirectory, { recursive: true });
    const primaryPath = path.join(this.storageDirectory, HISTORY_FILENAME);
    const backupPath = path.join(this.storageDirectory, BACKUP_FILENAME);
    const temporaryPath = path.join(
      this.storageDirectory,
      `${HISTORY_FILENAME}.tmp-${String(process.pid)}-${String(Date.now())}`,
    );
    await fs.writeFile(temporaryPath, serialized, 'utf8');
    parseConversationFile(JSON.parse(await fs.readFile(temporaryPath, 'utf8')) as unknown);
    if (await this.exists(primaryPath)) {
      await fs.copyFile(primaryPath, backupPath);
    }
    try {
      await fs.rename(temporaryPath, primaryPath);
    } catch (error) {
      const code = this.errorCode(error);
      if (code !== 'EEXIST' && code !== 'EPERM') {
        throw error;
      }
      await fs.copyFile(temporaryPath, primaryPath);
      await fs.unlink(temporaryPath);
    }
  }

  private serializedSize(value: ConversationFile): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  }

  private async readOptional(filePath: string): Promise<string | undefined> {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (this.errorCode(error) === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      if (this.errorCode(error) === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private async preserveCorrupt(filePath: string, label: string): Promise<void> {
    const suffix = this.now().toISOString().replace(/[:.]/gu, '-');
    await fs.copyFile(filePath, `${filePath}.corrupt-${label}-${suffix}`);
  }

  private errorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
