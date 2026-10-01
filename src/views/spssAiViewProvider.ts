import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { AiSessionController } from '../ai/aiSessionController';
import { aiStringsForLanguage, type AiStrings } from '../ai/aiStrings';
import { parseAssistantContent } from '../ai/fencedCode';
import type { KeyValueStore } from '../ai/providerConfigurationStore';
import { AI_PROVIDER_PRESETS, providerPreset } from '../ai/providerPresets';
import type { SpssEditorTargetTracker } from '../editor/spssEditorTargetTracker';
import {
  isAiWebviewMessage,
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
| { type: 'setComposerHeight' }
| { type: 'sendQuestion' }>;

export class SpssAiViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private webviewReady = false;
  private pendingPage: AiPage | undefined;
  private readonly strings: AiStrings;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: AiSessionController,
    private readonly editorTarget: SpssEditorTargetTracker,
    private readonly uiState: KeyValueStore,
    private readonly initialization: Promise<unknown> = Promise.resolve(),
  ) {
    this.strings = aiStringsForLanguage(vscode.env.language);
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.webviewReady = false;
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    };
    view.webview.html = this.shellHtml(view.webview, mediaRoot);
    view.webview.onDidReceiveMessage((value: unknown) => {
      if (isAiWebviewMessage(value)) {
        void this.handleMessage(value);
      }
    });
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
        this.webviewReady = false;
      }
    });
  }

  public async reveal(preserveFocus = false): Promise<void> {
    if (this.view) {
      this.view.show(preserveFocus);
      return;
    }
    await vscode.commands.executeCommand('spssStudio.aiView.focus');
    if (preserveFocus) {
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    }
  }

  public async showConfiguration(): Promise<void> {
    this.pendingPage = 'profiles';
    await this.reveal(false);
    if (this.webviewReady) {
      await this.postRenderState();
      await this.post({ type: 'showPage', page: 'profiles' });
      this.pendingPage = undefined;
    }
  }

  public dispose(): void {
    this.controller.dispose();
    this.view = undefined;
    this.webviewReady = false;
  }

  private async handleMessage(message: AiWebviewToExtensionMessage): Promise<void> {
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
      if (!await this.editorTarget.insert(message.code)) {
        void vscode.window.showWarningMessage(this.strings.insertRequiresEditor);
      }
      return;
    }
    if (message.type === 'copyCode') {
      await vscode.env.clipboard.writeText(message.code);
      return;
    }
    if (message.type === 'openProviderHelp') {
      await vscode.env.openExternal(vscode.Uri.parse(providerPreset(message.providerId).helpUrl));
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
        if (!await this.confirm(this.strings.deleteConversationConfirm, this.strings.delete)) {
          return;
        }
        await this.controller.deleteConversation(message.conversationId);
      } else if (message.type === 'clearAllConversations') {
        if (!await this.confirm(this.strings.clearAllConfirmFirst, this.strings.clearAll)) {
          return;
        }
        if (!await this.confirm(this.strings.clearAllConfirmSecond, this.strings.clearAll)) {
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
        if (!await this.confirm(this.strings.deleteProfileConfirm, this.strings.delete)) {
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
    if (!await this.requireTrustedWorkspace()) {
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

  private async confirm(message: string, action: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, action);
    return choice === action;
  }

  private async requireTrustedWorkspace(): Promise<boolean> {
    if (vscode.workspace.isTrusted) {
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      this.strings.untrustedWorkspace,
      this.strings.manageWorkspaceTrust,
    );
    if (choice === this.strings.manageWorkspaceTrust) {
      await vscode.commands.executeCommand('workbench.trust.manage');
    }
    return false;
  }

  private post(message: ExtensionToAiWebviewMessage): Thenable<boolean> | undefined {
    return this.view?.webview.postMessage(message);
  }

  private async postOperationError(error: unknown): Promise<void> {
    await this.post({ type: 'operationMessage', message: this.errorMessage(error), error: true });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private shellHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'ai.css'));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'ai.js'));
    const csp = [
      "default-src 'none'",
      "connect-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${css.toString()}" rel="stylesheet">
  <title>SPSS AI</title>
</head>
<body>
  <header class="ai-header">
    <nav id="tabs" class="tabs" aria-label="SPSS AI">
      <button type="button" data-page="chat" id="tab-chat"></button>
      <button type="button" data-page="history" id="tab-history"></button>
      <button type="button" data-page="profiles" id="tab-profiles"></button>
    </nav>
    <div class="header-actions">
      <label class="profile-selector"><span id="active-profile-label"></span><select id="active-profile"></select></label>
      <button id="new-chat" type="button"></button>
      <button id="manage-profiles" type="button"></button>
    </div>
  </header>
  <div id="banner" class="banner" hidden></div>
  <section id="page-chat" class="page chat-page">
    <main id="messages" aria-live="polite"></main>
    <div id="splitter" class="splitter" role="separator" aria-orientation="horizontal" tabindex="0"></div>
    <footer class="composer">
      <textarea id="question" placeholder=""></textarea>
      <div class="composer-actions">
        <span id="sending-status" class="sending-status"></span>
        <button id="stop" type="button" disabled></button>
        <button id="send" type="button"></button>
      </div>
    </footer>
  </section>
  <section id="page-history" class="page history-page" hidden>
    <div class="page-toolbar"><span id="history-heading"></span><button id="clear-history" type="button"></button></div>
    <div id="history-list" class="history-list"></div>
  </section>
  <section id="page-profiles" class="page profiles-page" hidden>
    <aside class="profiles-sidebar">
      <button id="new-profile" type="button"></button>
      <div id="profile-list" class="profile-list"></div>
    </aside>
    <form id="profile-form" class="profile-form">
      <label><span id="profile-name-label"></span><input id="profile-name" type="text" maxlength="120" autocomplete="off"></label>
      <label><span id="provider-label"></span><select id="provider"></select></label>
      <label class="wide"><span id="base-url-label"></span><input id="base-url" type="url" autocomplete="off"></label>
      <label><span id="model-label"></span><input id="model" type="text" autocomplete="off"></label>
      <label><span id="api-key-label"></span><input id="api-key" type="password" autocomplete="off"></label>
      <div id="key-status" class="key-status wide"></div>
      <div class="profile-actions wide">
        <button id="save-profile" type="submit"></button>
        <button id="duplicate-profile" type="button"></button>
        <button id="make-active" type="button"></button>
        <button id="delete-key" type="button"></button>
        <button id="delete-profile" type="button"></button>
        <button id="provider-help" type="button"></button>
      </div>
    </form>
  </section>
  <script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
  }
}
