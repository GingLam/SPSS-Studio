import type { AiSessionController } from '../ai/aiSessionController';
import { aiStringsForLanguage, type AiStrings } from '../ai/aiStrings';
import { parseAssistantContent } from '../ai/fencedCode';
import type { KeyValueStore } from '../ai/providerConfigurationStore';
import { AI_PROVIDER_PRESETS, providerPreset } from '../ai/providerPresets';
import {
  profileDraftFromMessage,
  type AiDisplayConversation,
  type AiPage,
  type AiViewRenderState,
  type AiWebviewToExtensionMessage,
  type ExtensionToAiWebviewMessage,
} from './aiWebviewProtocol';

const COMPOSER_HEIGHT_KEY = 'spssStudio.ai.composerHeight';
const DEFAULT_COMPOSER_HEIGHT = 112;

type MutationMessage = Exclude<AiWebviewToExtensionMessage,
| { type: 'ready' }
| { type: 'stop' }
| { type: 'insertCode' }
| { type: 'copyCode' }
| { type: 'openProviderHelp' }
| { type: 'openLink' }
| { type: 'setComposerHeight' }
| { type: 'sendQuestion' }>;

export interface SpssAiPanelPlatform {
  insertCode(code: string): Promise<boolean>;
  showWarning(message: string): void;
  writeClipboard(code: string): PromiseLike<void>;
  openExternal(url: string): PromiseLike<boolean>;
  confirm(message: string, action: string): Promise<boolean>;
  requireTrustedWorkspace(strings: AiStrings): Promise<boolean>;
}

type AiPostMessage = (message: ExtensionToAiWebviewMessage) => PromiseLike<boolean> | undefined;

export class SpssAiPanelController {
  private postTarget: AiPostMessage | undefined;
  private webviewReady = false;
  private pendingPage: AiPage | undefined;
  private readonly strings: AiStrings;

  public constructor(
    private readonly controller: AiSessionController,
    private readonly platform: SpssAiPanelPlatform,
    private readonly uiState: KeyValueStore,
    private readonly initialization: Promise<unknown> = Promise.resolve(),
    language = 'en',
  ) {
    this.strings = aiStringsForLanguage(language);
  }

  public attach(postTarget: AiPostMessage): void {
    this.postTarget = postTarget;
    this.webviewReady = false;
  }

  public detach(): void {
    this.postTarget = undefined;
    this.webviewReady = false;
  }

  public async showPage(page: AiPage): Promise<void> {
    this.pendingPage = page;
    if (!this.webviewReady) {
      return;
    }
    await this.postRenderState();
    await this.post({ type: 'showPage', page });
    this.pendingPage = undefined;
  }

  public async refresh(): Promise<void> {
    if (this.webviewReady) {
      await this.postRenderState();
    }
  }

  public async handleMessage(message: AiWebviewToExtensionMessage): Promise<void> {
    if (message.type === 'ready') {
      this.webviewReady = true;
      try {
        await this.initialization;
        await this.postRenderState();
        if (this.pendingPage) {
          await this.post({ type: 'showPage', page: this.pendingPage });
          this.pendingPage = undefined;
        }
      } catch (error) {
        await this.postOperationError(error);
      }
      return;
    }
    if (message.type === 'stop') {
      this.controller.stop();
      return;
    }
    if (message.type === 'insertCode') {
      if (!await this.platform.insertCode(message.code)) {
        this.platform.showWarning(this.strings.insertRequiresEditor);
      }
      return;
    }
    if (message.type === 'copyCode') {
      await this.platform.writeClipboard(message.code);
      return;
    }
    if (message.type === 'openProviderHelp') {
      await this.platform.openExternal(providerPreset(message.providerId).helpUrl);
      return;
    }
    if (message.type === 'openLink') {
      await this.platform.openExternal(message.url);
      return;
    }
    if (message.type === 'setComposerHeight') {
      await this.uiState.update(COMPOSER_HEIGHT_KEY, Math.round(message.height));
      return;
    }
    if (message.type === 'sendQuestion') {
      await this.sendQuestion(message.question.trim());
      return;
    }
    await this.handleMutation(message);
  }

  public dispose(): void {
    this.detach();
    this.controller.dispose();
  }

  private async handleMutation(message: MutationMessage): Promise<void> {
    try {
      if (message.type === 'newChat') {
        await this.controller.newChat();
      } else if (message.type === 'openConversation') {
        await this.controller.openConversation(message.conversationId);
        this.pendingPage = 'chat';
      } else if (message.type === 'renameConversation') {
        await this.controller.renameConversation(message.conversationId, message.title);
      } else if (message.type === 'deleteConversation') {
        if (!await this.platform.confirm(this.strings.deleteConversationConfirm, this.strings.delete)) {
          return;
        }
        await this.controller.deleteConversation(message.conversationId);
      } else if (message.type === 'clearAllConversations') {
        if (!await this.platform.confirm(this.strings.clearAllConfirmFirst, this.strings.clearAll)) {
          return;
        }
        if (!await this.platform.confirm(this.strings.clearAllConfirmSecond, this.strings.clearAll)) {
          return;
        }
        await this.controller.clearConversations();
      } else if (message.type === 'selectProfile') {
        await this.controller.selectProfile(message.profileId);
      } else if (message.type === 'createProfile') {
        await this.controller.createProfile(profileDraftFromMessage(message), message.apiKey);
      } else if (message.type === 'saveProfile') {
        await this.controller.updateProfile(
          message.profileId,
          profileDraftFromMessage(message),
          message.apiKey,
        );
      } else if (message.type === 'duplicateProfile') {
        await this.controller.duplicateProfile(message.profileId);
      } else if (message.type === 'deleteProfile') {
        if (!await this.platform.confirm(this.strings.deleteProfileConfirm, this.strings.delete)) {
          return;
        }
        await this.controller.deleteProfile(message.profileId);
      } else {
        await this.controller.deleteProfileKey(message.profileId);
      }
      await this.postRenderState();
      if (this.pendingPage) {
        await this.post({ type: 'showPage', page: this.pendingPage });
        this.pendingPage = undefined;
      }
    } catch (error) {
      await this.postOperationError(error);
    }
  }

  private async sendQuestion(question: string): Promise<void> {
    if (!await this.platform.requireTrustedWorkspace(this.strings)) {
      return;
    }
    try {
      const result = await this.controller.sendQuestion(question, {
        onStarted: (content) => {
          void this.post({ type: 'responseStarted', question: content });
        },
        onDelta: (content) => {
          void this.post({ type: 'responseDelta', content });
        },
      });
      await this.postRenderState(this.toViewState(result.state));
      if (result.persistenceWarning) {
        await this.post({
          type: 'operationMessage',
          message: `${this.strings.savedLocallyWarning} ${result.persistenceWarning}`,
          error: true,
        });
      }
    } catch (error) {
      await this.postRenderState();
      const message = this.errorMessage(error);
      await this.post({
        type: 'requestFailed',
        message,
        cancelled: /cancelled/iu.test(message),
        question,
      });
    }
  }

  private async postRenderState(renderState?: AiViewRenderState): Promise<void> {
    const state = renderState ?? this.toViewState(await this.controller.renderState());
    await this.post({
      type: 'renderState',
      composerHeight: this.composerHeight(),
      presets: [...AI_PROVIDER_PRESETS],
      state,
      strings: this.strings,
    });
  }

  private toViewState(state: Awaited<ReturnType<AiSessionController['renderState']>>): AiViewRenderState {
    const currentConversation: AiDisplayConversation | undefined = state.currentConversation === undefined
      ? undefined
      : {
        id: state.currentConversation.id,
        title: state.currentConversation.title,
        createdAt: state.currentConversation.createdAt,
        updatedAt: state.currentConversation.updatedAt,
        truncated: state.currentConversation.truncated === true,
        messages: state.currentConversation.messages.map((message) => message.role === 'user'
          ? {
            id: message.id,
            role: 'user',
            createdAt: message.createdAt,
            content: message.content,
          }
          : {
            id: message.id,
            role: 'assistant',
            createdAt: message.createdAt,
            ...(message.profileName === undefined ? {} : { profileName: message.profileName }),
            segments: parseAssistantContent(message.content),
          }),
      };
    return currentConversation === undefined
      ? { busy: state.busy, profiles: state.profiles, history: state.history }
      : { busy: state.busy, profiles: state.profiles, history: state.history, currentConversation };
  }

  private composerHeight(): number {
    const stored = this.uiState.get(COMPOSER_HEIGHT_KEY);
    return typeof stored === 'number' && Number.isFinite(stored)
      ? Math.max(72, Math.min(600, Math.round(stored)))
      : DEFAULT_COMPOSER_HEIGHT;
  }

  private async postOperationError(error: unknown): Promise<void> {
    await this.post({ type: 'operationMessage', message: this.errorMessage(error), error: true });
  }

  private post(message: ExtensionToAiWebviewMessage): PromiseLike<boolean> | undefined {
    return this.postTarget?.(message);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
