import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { buildQuickStartHtml } from './quickStartContent';
import {
  isQuickStartMessage,
  QUICK_START_LAST_VERSION_KEY,
  QUICK_START_SUPPRESS_UPDATES_KEY,
  quickStartLanguage,
  shouldShowQuickStart,
  type QuickStartLanguage,
} from './quickStartState';

export class QuickStartController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly language: QuickStartLanguage;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalState: vscode.Memento,
    uiLanguage: string,
  ) {
    this.language = quickStartLanguage(uiLanguage);
  }

  public async maybeShowForVersion(currentVersion: string): Promise<void> {
    const lastObservedVersion = this.globalState.get<string>(QUICK_START_LAST_VERSION_KEY);
    const suppressAfterUpdates = this.globalState.get<boolean>(
      QUICK_START_SUPPRESS_UPDATES_KEY,
      false,
    );
    const displayState = lastObservedVersion === undefined
      ? { suppressAfterUpdates }
      : { lastObservedVersion, suppressAfterUpdates };
    if (shouldShowQuickStart(currentVersion, displayState)) {
      this.show();
    }
    await this.globalState.update(QUICK_START_LAST_VERSION_KEY, currentVersion);
  }

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
      this.render();
      return;
    }
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      'spssStudio.quickStart',
      this.language === 'zh-cn' ? '快速上手' : 'Quick Start',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [mediaRoot],
      },
    );
    this.panel = panel;
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });
    panel.webview.onDidReceiveMessage((value: unknown) => {
      if (!isQuickStartMessage(value)) {
        return;
      }
      void this.saveSuppressPreference(panel, value.value);
    });
    this.render();
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private render(): void {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'quick-start.css'),
    );
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'quick-start.js'),
    );
    panel.webview.html = buildQuickStartHtml({
      language: this.language,
      suppressAfterUpdates: this.globalState.get<boolean>(
        QUICK_START_SUPPRESS_UPDATES_KEY,
        false,
      ),
      styleUri: styleUri.toString(),
      scriptUri: scriptUri.toString(),
      nonce: randomBytes(18).toString('base64url'),
      cspSource: panel.webview.cspSource,
    });
  }

  private async saveSuppressPreference(
    panel: vscode.WebviewPanel,
    value: boolean,
  ): Promise<void> {
    await this.globalState.update(QUICK_START_SUPPRESS_UPDATES_KEY, value);
    await panel.webview.postMessage({ type: 'suppressPreferenceSaved', value });
  }
}
