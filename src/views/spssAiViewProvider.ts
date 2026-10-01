import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { boundConversation, type AiChatMessage } from '../ai/chatProtocol';
import { parseAssistantContent } from '../ai/fencedCode';
import type { OpenAiCompatibleClient } from '../ai/openAiCompatibleClient';
import type { ProviderConfigurationStore } from '../ai/providerConfigurationStore';
import { AI_PROVIDER_PRESETS, providerPreset } from '../ai/providerPresets';
import type { SpssEditorTargetTracker } from '../editor/spssEditorTargetTracker';
import {
  configurationFromMessage,
  isAiWebviewMessage,
  type AiDisplayMessage,
  type AiWebviewToExtensionMessage,
  type ExtensionToAiWebviewMessage,
} from './aiWebviewProtocol';

interface ActiveAiRequest {
  id: number;
  controller: AbortController;
}

export class SpssAiViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private history: AiChatMessage[] = [];
  private activeRequest: ActiveAiRequest | undefined;
  private requestSequence = 0;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configurationStore: ProviderConfigurationStore,
    private readonly client: OpenAiCompatibleClient,
    private readonly editorTarget: SpssEditorTargetTracker,
  ) {}

  public async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
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
      }
    });
    await this.initialize();
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
    await this.reveal(false);
    await this.post({ type: 'showConfiguration' });
  }

  public dispose(): void {
    this.activeRequest?.controller.abort();
    this.activeRequest = undefined;
    this.view = undefined;
    this.history = [];
  }

  private async initialize(): Promise<void> {
    const history: AiDisplayMessage[] = this.history.map((message) => message.role === 'user'
      ? { role: 'user', content: message.content }
      : { role: 'assistant', segments: parseAssistantContent(message.content) });
    await this.post({
      type: 'initialize',
      presets: [...AI_PROVIDER_PRESETS],
      state: await this.configurationStore.state(),
      history,
    });
  }

  private async handleMessage(message: AiWebviewToExtensionMessage): Promise<void> {
    if (message.type === 'sendQuestion') {
      await this.sendQuestion(message.question.trim());
    } else if (message.type === 'stop') {
      this.activeRequest?.controller.abort();
    } else if (message.type === 'clear') {
      this.clearConversation();
    } else if (message.type === 'insertCode') {
      if (!await this.editorTarget.insert(message.code)) {
        void vscode.window.showWarningMessage('Open an SPSS syntax editor before inserting AI-generated code.');
      }
    } else if (message.type === 'copyCode') {
      await vscode.env.clipboard.writeText(message.code);
    } else if (message.type === 'saveConfiguration') {
      await this.saveConfiguration(message);
    } else if (message.type === 'deleteApiKey') {
      await this.configurationStore.deleteApiKey(message.providerId);
      await this.post({ type: 'configurationState', state: await this.configurationStore.state() });
    } else {
      await vscode.env.openExternal(vscode.Uri.parse(providerPreset(message.providerId).helpUrl));
    }
  }

  private async saveConfiguration(
    message: Extract<AiWebviewToExtensionMessage, { type: 'saveConfiguration' }>,
  ): Promise<void> {
    try {
      await this.configurationStore.save(configurationFromMessage(message), message.apiKey);
      await this.post({ type: 'configurationState', state: await this.configurationStore.state() });
    } catch (error) {
      await this.post({ type: 'configurationError', message: this.errorMessage(error) });
    }
  }

  private async sendQuestion(question: string): Promise<void> {
    if (this.activeRequest) {
      return;
    }
    if (!await this.requireTrustedWorkspace()) {
      return;
    }
    let resolved;
    try {
      resolved = await this.configurationStore.resolve();
    } catch (error) {
      await this.post({ type: 'configurationError', message: this.errorMessage(error) });
      return;
    }

    const previousHistory = this.history;
    this.history = boundConversation([...this.history, { role: 'user', content: question }]);
    const request: ActiveAiRequest = {
      id: ++this.requestSequence,
      controller: new AbortController(),
    };
    this.activeRequest = request;
    await this.post({ type: 'appendUser', content: question });
    await this.post({ type: 'responseStarted' });
    try {
      const response = await this.client.streamChat({
        configuration: resolved.configuration,
        apiKey: resolved.apiKey,
        history: this.history,
        signal: request.controller.signal,
      }, (content) => {
        if (this.activeRequest?.id === request.id) {
          void this.post({ type: 'responseDelta', content });
        }
      });
      if (!this.isCurrentRequest(request.id)) {
        return;
      }
      this.history = boundConversation([...this.history, { role: 'assistant', content: response }]);
      await this.post({ type: 'responseCompleted', segments: parseAssistantContent(response) });
    } catch (error) {
      if (!this.isCurrentRequest(request.id)) {
        return;
      }
      this.history = previousHistory;
      const message = this.errorMessage(error);
      await this.post({
        type: 'responseFailed',
        message,
        cancelled: /cancelled/iu.test(message),
      });
    } finally {
      if (this.isCurrentRequest(request.id)) {
        this.activeRequest = undefined;
      }
    }
  }

  private clearConversation(): void {
    this.requestSequence += 1;
    this.activeRequest?.controller.abort();
    this.activeRequest = undefined;
    this.history = [];
    void this.post({ type: 'conversationCleared' });
  }

  private async requireTrustedWorkspace(): Promise<boolean> {
    if (vscode.workspace.isTrusted) {
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      'Sending an AI question is disabled in an untrusted workspace.',
      'Manage Workspace Trust',
    );
    if (choice === 'Manage Workspace Trust') {
      await vscode.commands.executeCommand('workbench.trust.manage');
    }
    return false;
  }

  private post(message: ExtensionToAiWebviewMessage): Thenable<boolean> | undefined {
    return this.view?.webview.postMessage(message);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private isCurrentRequest(id: number): boolean {
    return this.activeRequest?.id === id;
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
    <div><strong>SPSS AI</strong><span id="provider-summary">Not configured</span></div>
    <button id="configure" type="button">Configure</button>
  </header>
  <div id="banner" class="banner" hidden></div>
  <section id="configuration" class="configuration" hidden>
    <label>Provider<select id="provider"></select></label>
    <label>Base URL<input id="base-url" type="url" autocomplete="off"></label>
    <label>Model<input id="model" type="text" autocomplete="off"></label>
    <label>API Key<input id="api-key" type="password" autocomplete="off" placeholder="Leave blank to keep the saved key"></label>
    <div id="key-status" class="key-status"></div>
    <div class="configuration-actions">
      <button id="save-configuration" type="button">Save</button>
      <button id="cancel-configuration" type="button">Cancel</button>
      <button id="delete-key" type="button">Delete key</button>
      <button id="provider-help" type="button">Official docs</button>
    </div>
  </section>
  <main id="messages" aria-live="polite">
    <div id="empty-state" class="empty-state">Ask a question about SPSS Syntax. Only the text typed here is sent to the configured provider.</div>
  </main>
  <footer class="composer">
    <textarea id="question" rows="3" placeholder="Ask about SPSS Syntax…"></textarea>
    <div class="composer-actions">
      <button id="send" type="button">Send</button>
      <button id="stop" type="button" disabled>Stop</button>
      <button id="clear" type="button">Clear</button>
    </div>
  </footer>
  <script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
  }
}
