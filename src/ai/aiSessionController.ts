import { randomUUID } from 'node:crypto';
import {
  DEFAULT_AI_RESPONSE_LANGUAGE,
  type AiAssistantContext,
  type AiChatMessage,
  type AiResponseLanguage,
} from './chatProtocol';
import type { ConversationStore } from './conversationStore';
import { conversationTitleFromQuestion } from './conversationTitle';
import type {
  ConversationQuestionKind,
  StoredConversation,
  StoredConversationMessage,
} from './conversation';
import type { ModelProfileDraft } from './modelProfile';
import type { ModelProfileStore } from './modelProfileStore';
import type { StreamChatOptions } from './openAiCompatibleClient';
import type { AiRenderState, AiSendCallbacks, AiSendResult } from './aiRenderState';
import { appendExploreDisclaimer, isOutOfScopeReply } from './variableExplore';

export type AiQuestionKind = ConversationQuestionKind;

export interface AiChatTransport {
  streamChat(options: StreamChatOptions, onDelta: (delta: string) => void): Promise<string>;
}

interface AiSessionControllerOptions {
  createId?: () => string;
  now?: () => Date;
}

interface ActiveRequest {
  id: number;
  controller: AbortController;
}

export class AiSessionController {
  private activeRequest: ActiveRequest | undefined;
  private requestSequence = 0;
  private readonly createId: () => string;
  private readonly now: () => Date;

  public constructor(
    private readonly profiles: ModelProfileStore,
    private readonly conversations: ConversationStore,
    private readonly transport: AiChatTransport,
    options: AiSessionControllerOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  public get busy(): boolean {
    return this.activeRequest !== undefined;
  }

  public async renderState(): Promise<AiRenderState> {
    const [profiles, conversationFile, history] = await Promise.all([
      this.profiles.state(),
      this.conversations.state(),
      this.conversations.summaries(),
    ]);
    const currentConversation = conversationFile.activeConversationId === undefined
      ? undefined
      : conversationFile.conversations.find(
        (conversation) => conversation.id === conversationFile.activeConversationId,
      );
    return currentConversation === undefined
      ? { busy: this.busy, profiles, history }
      : { busy: this.busy, profiles, history, currentConversation };
  }

  public async sendQuestion(
    question: string,
    callbacks: AiSendCallbacks = {},
    responseLanguage: AiResponseLanguage = DEFAULT_AI_RESPONSE_LANGUAGE,
    questionKind: AiQuestionKind = 'manual',
  ): Promise<AiSendResult> {
    if (this.activeRequest) {
      throw new Error('Wait for the current AI response or stop it before sending another question.');
    }
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      throw new Error('Enter a question for SPSS AI.');
    }
    const resolved = await this.profiles.resolve();
    const state = await this.conversations.state();
    const current = state.activeConversationId === undefined
      ? undefined
      : state.conversations.find((conversation) => conversation.id === state.activeConversationId);
    const timestamp = this.now().toISOString();
    const assistantContext = this.assistantContext(current?.context, questionKind);
    const userMessage: StoredConversationMessage = {
      id: this.createId(),
      role: 'user',
      content: normalizedQuestion,
      createdAt: timestamp,
      questionKind,
    };
    const request: ActiveRequest = {
      id: ++this.requestSequence,
      controller: new AbortController(),
    };
    this.activeRequest = request;
    callbacks.onStarted?.(normalizedQuestion);
    try {
      const requestHistory: AiChatMessage[] = [
        ...(current?.messages ?? []).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: 'user', content: normalizedQuestion },
      ];
      const rawResponse = await this.transport.streamChat({
        configuration: resolved.configuration,
        apiKey: resolved.apiKey,
        history: requestHistory,
        responseLanguage,
        assistantContext,
        reasoningEnabled: resolved.profile.reasoningEnabled,
        signal: request.controller.signal,
      }, (delta) => {
        if (this.isCurrentRequest(request.id)) {
          callbacks.onDelta?.(delta);
        }
      });
      if (!this.isCurrentRequest(request.id)) {
        throw new Error('The AI request was cancelled.');
      }
      const response = assistantContext === 'variableExplore' && !isOutOfScopeReply(rawResponse)
        ? appendExploreDisclaimer(rawResponse, responseLanguage)
        : rawResponse;
      const assistantMessage: StoredConversationMessage = {
        id: this.createId(),
        role: 'assistant',
        content: response,
        createdAt: this.now().toISOString(),
        profileId: resolved.profile.id,
        profileName: resolved.profile.name,
        providerId: resolved.profile.providerId,
        model: resolved.profile.model,
      };
      const conversation: StoredConversation = current === undefined
        ? {
          id: this.createId(),
          title: conversationTitleFromQuestion(normalizedQuestion),
          createdAt: timestamp,
          updatedAt: assistantMessage.createdAt,
          lastProfileId: resolved.profile.id,
          lastProfileName: resolved.profile.name,
          context: assistantContext,
          messages: [userMessage, assistantMessage],
        }
        : {
          ...current,
          updatedAt: assistantMessage.createdAt,
          lastProfileId: resolved.profile.id,
          lastProfileName: resolved.profile.name,
          context: assistantContext,
          messages: [...current.messages, userMessage, assistantMessage],
        };
      let persistenceWarning: string | undefined;
      try {
        await this.conversations.save(conversation);
      } catch (error) {
        persistenceWarning = this.errorMessage(error);
      }
      if (this.isCurrentRequest(request.id)) {
        this.activeRequest = undefined;
      }
      const nextState = await this.renderState();
      return persistenceWarning === undefined
        ? { response, state: nextState }
        : { response, state: nextState, persistenceWarning };
    } finally {
      if (this.isCurrentRequest(request.id)) {
        this.activeRequest = undefined;
      }
    }
  }

  public stop(): void {
    this.activeRequest?.controller.abort();
  }

  public dispose(): void {
    this.stop();
    this.activeRequest = undefined;
  }

  private assistantContext(
    current: StoredConversation['context'],
    questionKind: AiQuestionKind,
  ): AiAssistantContext {
    if (questionKind === 'variableExplore') {
      return 'variableExplore';
    }
    if (questionKind === 'manual' && current === 'variableExplore') {
      return 'variableExplore';
    }
    return 'standard';
  }

  public async newChat(): Promise<AiRenderState> {
    this.requireIdle();
    await this.conversations.deactivate();
    return this.renderState();
  }

  public async openConversation(conversationId: string): Promise<AiRenderState> {
    this.requireIdle();
    await this.conversations.setActive(conversationId);
    const conversation = await this.conversations.get(conversationId);
    if (conversation?.lastProfileId) {
      const state = await this.profiles.state();
      if (state.profiles.some((profile) => profile.id === conversation.lastProfileId)) {
        await this.profiles.select(conversation.lastProfileId);
      }
    }
    return this.renderState();
  }

  public async renameConversation(conversationId: string, title: string): Promise<AiRenderState> {
    this.requireIdle();
    await this.conversations.rename(conversationId, title);
    return this.renderState();
  }

  public async deleteConversation(conversationId: string): Promise<AiRenderState> {
    this.requireIdle();
    await this.conversations.delete(conversationId);
    return this.renderState();
  }

  public async clearConversations(): Promise<AiRenderState> {
    this.requireIdle();
    await this.conversations.clear();
    return this.renderState();
  }

  public async selectProfile(profileId: string): Promise<AiRenderState> {
    this.requireIdle();
    await this.profiles.select(profileId);
    return this.renderState();
  }

  public async createProfile(draft: ModelProfileDraft, apiKey?: string): Promise<AiRenderState> {
    this.requireIdle();
    const profile = await this.profiles.create(draft, apiKey);
    await this.profiles.select(profile.id);
    return this.renderState();
  }

  public async updateProfile(
    profileId: string,
    draft: ModelProfileDraft,
    apiKey?: string,
  ): Promise<AiRenderState> {
    this.requireIdle();
    await this.profiles.update(profileId, draft, apiKey);
    return this.renderState();
  }

  public async duplicateProfile(profileId: string): Promise<AiRenderState> {
    this.requireIdle();
    const profile = await this.profiles.duplicate(profileId);
    await this.profiles.select(profile.id);
    return this.renderState();
  }

  public async deleteProfile(profileId: string): Promise<AiRenderState> {
    this.requireIdle();
    await this.profiles.delete(profileId);
    return this.renderState();
  }

  public async deleteProfileKey(profileId: string): Promise<AiRenderState> {
    this.requireIdle();
    await this.profiles.deleteApiKey(profileId);
    return this.renderState();
  }

  private requireIdle(): void {
    if (this.activeRequest) {
      throw new Error('Stop the current AI response before changing SPSS AI state.');
    }
  }

  private isCurrentRequest(requestId: number): boolean {
    return this.activeRequest?.id === requestId;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
