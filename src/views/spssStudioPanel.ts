import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  buildOutputExplanationQuestion,
  extractSpssOutputForAi,
} from '../ai/outputExplanation';
import { buildVariableExploreQuestion } from '../ai/variableExplore';
import {
  formatLocalized,
  runtimeStringsForLanguage,
} from '../localization/runtimeStrings';
import type {
  ActiveDatasetInfo,
  DatasetPage,
  EngineState,
  VariableProfiles,
} from '../spss/types';
import { sanitizeSpssHtml } from './htmlSanitizer';
import { createSpssOutputBlocks, buildSelectedOutputQuestion, buildSelectedOutputHtml } from './spssOutputBlocks';
import { normalizeVariableWindow } from './dataViewportState';
import type { AiPage, ExtensionToAiWebviewMessage } from './aiWebviewProtocol';
import type { ExecutionRecord, OutputStore } from './outputStore';
import { buildPortableOutputHtml } from './portableOutput';
import type { SpssAiPanelController } from './spssAiPanelController';
import { studioStringsForLanguage } from './studioStrings';
import {
  isStudioShellMessage,
  type StudioTab,
} from './studioShellProtocol';
import {
  type DatasetPageUiRequest,
  type ExtensionToWebviewMessage,
} from './webviewProtocol';

export interface SpssStudioPanelCallbacks {
  requestDatasetPage: (page: DatasetPageUiRequest) => Promise<void>;
  refreshData: () => Promise<void>;
  refreshVariables: () => Promise<void>;
  insertVariable: (name: string) => Promise<void>;
  copyVariables: (names: string[]) => Promise<void>;
  insertVariables: (names: string[]) => Promise<void>;
  exploreVariables: (names: string[]) => Promise<VariableProfiles>;
  clearOutput: () => void;
  clearData: () => Promise<void>;
}

export class SpssStudioPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private activeTab: StudioTab = 'output';
  private webviewReady = false;
  private engineState: EngineState = 'stopped';
  private dataset: ActiveDatasetInfo | undefined;
  private datasetRevision = 0;
  private dataActionsBusy = false;
  private page: DatasetPage | undefined;
  private pageRequest = { requestId: 0, generation: 0 };
  private selectedHtmlLength = 0;
  private readonly studioStrings = studioStringsForLanguage(vscode.env.language);
  private readonly runtimeStrings = runtimeStringsForLanguage(vscode.env.language);

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputStore: OutputStore,
    private readonly callbacks: SpssStudioPanelCallbacks,
    private readonly aiController: SpssAiPanelController,
  ) {}

  public get dataVisible(): boolean {
    return this.panel?.visible === true && this.activeTab === 'data';
  }

  public get currentPageSummary(): { rows: number; variables: number; totalCases: number } | undefined {
    return this.page
      ? { rows: this.page.rows.length, variables: this.page.variables.length, totalCases: this.page.totalCases }
      : undefined;
  }

  public get renderedOutputLength(): number {
    return this.selectedHtmlLength;
  }

  public showOutput(): void {
    const panel = this.ensurePanel();
    this.activeTab = 'output';
    panel.reveal(vscode.ViewColumn.Beside, true);
    void this.postStudio({ type: 'showOutput' });
    void this.postSelected();
  }

  public showData(): void {
    const panel = this.ensurePanel();
    this.activeTab = 'data';
    panel.reveal(vscode.ViewColumn.Beside, true);
    void this.postStudio({ type: 'showData' });
    void this.postStudio({ type: 'datasetMetadata', dataset: this.dataset ?? null, revision: this.datasetRevision });
    if (this.page) {
      void this.postStudio({ type: 'datasetPage', page: this.page, ...this.pageRequest });
    } else {
      void this.callbacks.refreshData();
    }
  }

  public showVariables(): void {
    const panel = this.ensurePanel();
    this.activeTab = 'variables';
    panel.reveal(vscode.ViewColumn.Beside, true);
    void this.postStudio({ type: 'showVariables' });
    void this.postStudio({ type: 'datasetMetadata', dataset: this.dataset ?? null, revision: this.datasetRevision });
    if (!this.dataset) {
      void this.callbacks.refreshVariables();
    }
  }

  public showAi(page: AiPage = 'chat'): void {
    const panel = this.ensurePanel();
    this.activeTab = 'ai';
    panel.reveal(vscode.ViewColumn.Beside, false);
    void this.postStudio({ type: 'showAi' });
    void this.aiController.showPage(page);
  }

  public executionStarted(record: ExecutionRecord): void {
    this.showOutput();
    void this.postStudio({ type: 'executionStarted', history: this.outputStore.metadata, selectedId: record.id });
  }

  public executionCompleted(record: ExecutionRecord): void {
    void this.postStudio({ type: 'executionCompleted', history: this.outputStore.metadata, selectedId: record.id });
    void this.selectExecution(record.id);
  }

  public setDatasetMetadata(dataset: ActiveDatasetInfo | undefined): void {
    this.dataset = dataset;
    this.datasetRevision += 1;
    void this.postStudio({ type: 'datasetMetadata', dataset: dataset ?? null, revision: this.datasetRevision });
  }

  public setDatasetPage(page: DatasetPage, requestId = 0, generation = 0): void {
    this.page = page;
    this.pageRequest = { requestId, generation };
    void this.postStudio({ type: 'datasetPage', page, requestId, generation });
  }

  public clearDatasetPage(): void {
    this.page = undefined;
  }

  public setEngineState(state: EngineState): void {
    this.engineState = state;
    void this.postStudio({ type: 'engineState', state });
  }

  public outputCleared(): void {
    void this.postStudio({ type: 'outputCleared' });
  }

  public setDataActionsBusy(busy: boolean): void {
    this.dataActionsBusy = busy;
    void this.postStudio({ type: 'dataActionState', busy });
  }

  public dataCleared(): void {
    void this.postStudio({ type: 'dataCleared' });
  }

  private async confirmClearData(): Promise<void> {
    if (this.dataActionsBusy || !vscode.workspace.isTrusted) { return; }
    const action = this.studioStrings.clear;
    if (await vscode.window.showWarningMessage(this.studioStrings.clearDataConfirm, { modal: true }, action) !== action) { return; }
    await this.runVariableAction(this.callbacks.clearData, this.studioStrings.clearDataFailed);
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.webviewReady = false;
    this.aiController.detach();
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) {
      return this.panel;
    }
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      'spssStudio',
      'SPSS Studio',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot, vscode.Uri.file(this.outputStore.sessionRoot)],
      },
    );
    this.panel = panel;
    this.aiController.attach((message: ExtensionToAiWebviewMessage) => (
      panel.webview.postMessage({ scope: 'ai', message })
    ));
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
        this.webviewReady = false;
        this.aiController.detach();
      }
    });
    panel.onDidChangeViewState(() => {
      if (panel.visible && this.activeTab === 'data' && !this.page) {
        void this.callbacks.refreshData();
      } else if (panel.visible && this.activeTab === 'variables' && !this.dataset) {
        void this.callbacks.refreshVariables();
      }
    });
    panel.webview.onDidReceiveMessage((value: unknown) => {
      if (!isStudioShellMessage(value)) {
        return;
      }
      if (value.scope === 'shell') {
        this.webviewReady = true;
        void this.postInitialState();
        void this.aiController.handleMessage({ type: 'ready' });
        return;
      }
      if (value.scope === 'ai') {
        void this.aiController.handleMessage(value.message);
        return;
      }
      const message = value.message;
      if (message.type === 'selectExecution') {
        void this.selectExecution(message.id);
      } else if (message.type === 'showOutput') {
        this.activeTab = 'output';
      } else if (message.type === 'showData') {
        this.activeTab = 'data';
        if (!this.page) {
          void this.callbacks.refreshData();
        }
      } else if (message.type === 'requestDatasetPage') {
        const variableWindow = normalizeVariableWindow(
          message.variableStart,
          this.dataset?.variableCount ?? message.variableStart + message.variableLimit,
          message.variableLimit,
        );
        void this.callbacks.requestDatasetPage({
          offset: message.offset,
          limit: message.limit,
          ...variableWindow,
          requestId: message.requestId,
          generation: message.generation,
        });
      } else if (message.type === 'showVariables') {
        this.activeTab = 'variables';
        if (!this.dataset) {
          void this.callbacks.refreshVariables();
        }
      } else if (message.type === 'showAi') {
        this.activeTab = 'ai';
        void this.aiController.refresh();
      } else if (message.type === 'refreshData') {
        void this.callbacks.refreshData();
      } else if (message.type === 'refreshVariables') {
        void this.callbacks.refreshVariables();
      } else if (message.type === 'explainOutput') {
        void this.explainOutput(message.id, message.blockIds);
      } else if (message.type === 'exportOutput') {
        void this.exportOutput(message.id, message.blockIds);
      } else if (message.type === 'printOutput') {
        void this.printOutput(message.id, message.blockIds);
      } else if (message.type === 'insertVariable') {
        void this.callbacks.insertVariable(message.name);
      } else if (message.type === 'copyVariables') {
        void this.runVariableAction(
          () => this.callbacks.copyVariables(message.names),
          this.runtimeStrings.copyVariablesFailed,
        );
      } else if (message.type === 'insertVariables') {
        void this.runVariableAction(
          () => this.callbacks.insertVariables(message.names),
          this.runtimeStrings.insertVariablesFailed,
        );
      } else if (message.type === 'exploreVariables') {
        void this.exploreVariables(message.names);
      } else if (message.type === 'clearData') {
        void this.confirmClearData();
      } else {
        this.callbacks.clearOutput();
      }
    });
    // Install the host receiver before loading scripts so the ready handshake cannot be missed.
    panel.webview.html = this.shellHtml(panel.webview, mediaRoot);
    return panel;
  }

  private async postInitialState(): Promise<void> {
    await this.postStudio({ type: 'engineState', state: this.engineState });
    await this.postStudio({ type: 'dataActionState', busy: this.dataActionsBusy });
    await this.postStudio({
      type: 'datasetMetadata',
      dataset: this.dataset ?? null,
      revision: this.datasetRevision,
    });
    const selected = this.outputStore.selected;
    if (selected) {
      await this.postStudio({
        type: 'executionCompleted',
        history: this.outputStore.metadata,
        selectedId: selected.id,
      });
      await this.selectExecution(selected.id);
    }
    const showType: Record<StudioTab, ExtensionToWebviewMessage['type']> = {
      output: 'showOutput',
      data: 'showData',
      variables: 'showVariables',
      ai: 'showAi',
    };
    await this.postStudio({ type: showType[this.activeTab] } as ExtensionToWebviewMessage);
  }

  private async selectExecution(id: string): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const record = this.outputStore.select(id);
    const rawHtml = this.outputStore.readHtml(id) ?? '';
    const presentation = createSpssOutputBlocks(rawHtml, vscode.env.language.toLowerCase() === 'zh-cn' ? 'zh-CN' : 'en');
    const html = record.htmlPath
      ? sanitizeSpssHtml(presentation.html, (source) => this.resolveImage(panel.webview, record, source))
      : '';
    this.selectedHtmlLength = html.length;
    const metadata = this.outputStore.metadata.find((item) => item.id === id);
    if (metadata) {
      await this.postStudio({ type: 'executionSelected', record: metadata, html, blocks: presentation.blocks.map(({ id, title }) => ({ id, title })) });
    }
  }

  private async postSelected(): Promise<void> {
    const selected = this.outputStore.selected;
    if (selected) {
      await this.selectExecution(selected.id);
    }
  }

  private async exportOutput(id: string, blockIds?: string[]): Promise<void> {
    const source = this.outputSource(id, blockIds);
    if (!source) {
      return;
    }
    try {
      // Inline images before awaiting the dialog, so clearing history cannot
      // change either the selected HTML or its local raster images mid-export.
      const html = buildPortableOutputHtml(
        source.rawHtml,
        source.record.outputDirectory,
        source.record.htmlPath,
      );
      const timestamp = source.record.timestamp.replace(/[-:]/gu, '').replace(/\..+$/u, '').replace('T', '-');
      const fileName = `SPSS-output-run-${String(source.record.sequence)}-${timestamp}.html`;
      const options: vscode.SaveDialogOptions = {
        filters: { HTML: ['html'] }, saveLabel: this.runtimeStrings.exportSaveLabel,
      };
      const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (workspace) { options.defaultUri = vscode.Uri.joinPath(workspace, fileName); }
      const target = await vscode.window.showSaveDialog(options);
      if (!target) { return; }
      await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
      void vscode.window.showInformationMessage(formatLocalized(
        this.runtimeStrings.outputExported,
        { path: target.fsPath || target.toString() },
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`${this.runtimeStrings.outputExportFailed}: ${message}`);
    }
  }

  private async explainOutput(id: string, blockIds?: string[]): Promise<void> {
    const source = this.outputSource(id);
    if (!source) {
      return;
    }
    let question: string;
    if (blockIds?.length) {
      const { blocks } = createSpssOutputBlocks(source.rawHtml, this.aiController.responseLanguage);
      try {
        question = buildSelectedOutputQuestion(blocks, blockIds, this.aiController.responseLanguage);
      } catch {
        void vscode.window.showInformationMessage(this.studioStrings.outputSelectionInvalid);
        return;
      }
    } else {
      const extracted = extractSpssOutputForAi(source.rawHtml, this.aiController.responseLanguage);
      if (!extracted.content) {
        void vscode.window.showInformationMessage(this.runtimeStrings.noExplainableOutput);
        return;
      }
      question = buildOutputExplanationQuestion(
        extracted.content, this.aiController.responseLanguage,
      );
    }
    this.showAi('chat');
    await this.aiController.sendQuestionFromEditor(question, 'outputExplain');
  }

  private async runVariableAction(action: () => Promise<void>, failureMessage: string): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`${failureMessage}: ${message}`);
    }
  }

  private async exploreVariables(names: string[]): Promise<void> {
    try {
      if (names.length > 20) {
        void vscode.window.showWarningMessage(this.runtimeStrings.exploreLimit);
        return;
      }
      const profiles = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: this.runtimeStrings.preparingVariableSummaries,
      }, () => this.callbacks.exploreVariables(names));
      const question = buildVariableExploreQuestion(profiles, this.aiController.responseLanguage);
      this.showAi('chat');
      await this.aiController.sendQuestionFromEditor(question, 'variableExplore');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`${this.runtimeStrings.exploreVariablesFailed}: ${message}`);
    } finally {
      void this.postStudio({ type: 'variableExploreFinished' });
    }
  }

  private async printOutput(id: string, blockIds?: string[]): Promise<void> {
    const source = this.outputSource(id, blockIds);
    if (!source) {
      return;
    }
    try {
      const html = buildPortableOutputHtml(
        source.rawHtml,
        source.record.outputDirectory,
        source.record.htmlPath,
        { print: true },
      );
      const printPath = path.join(source.record.outputDirectory, `print-${randomBytes(8).toString('hex')}.html`);
      await fs.promises.writeFile(printPath, html, 'utf8');
      const opened = await vscode.env.openExternal(vscode.Uri.file(printPath));
      if (!opened) {
        void vscode.window.showErrorMessage(this.runtimeStrings.printableOutputNotOpened);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`${this.runtimeStrings.printableOutputFailed}: ${message}`);
    }
  }

  private outputSource(id: string, blockIds?: string[]): { record: ExecutionRecord & { htmlPath: string }; rawHtml: string } | undefined {
    const record = this.outputStore.get(id);
    if (!record?.htmlPath || record.status === 'RUNNING') {
      void vscode.window.showInformationMessage(this.runtimeStrings.selectedRunNoHtml);
      return undefined;
    }
    let rawHtml = this.outputStore.readHtml(id);
    if (rawHtml === undefined) {
      void vscode.window.showErrorMessage(this.runtimeStrings.selectedHtmlUnavailable);
      return undefined;
    }
    if (blockIds?.length) {
      try {
        rawHtml = buildSelectedOutputHtml(rawHtml, blockIds, vscode.env.language.startsWith('zh') ? 'zh-CN' : 'en');
      } catch {
        void vscode.window.showInformationMessage(this.studioStrings.outputSelectionInvalid);
        return undefined;
      }
    }
    return { record: record as ExecutionRecord & { htmlPath: string }, rawHtml };
  }

  private resolveImage(webview: vscode.Webview, record: ExecutionRecord, source: string): string | undefined {
    if (/^data:image\/(?:png|jpe?g|gif|bmp);base64,[a-z0-9+/=\s]+$/iu.test(source)) {
      return source;
    }
    if (/^(?:https?:|javascript:|data:|\/\/)/iu.test(source)) {
      return undefined;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(source.replace(/^file:\/\//iu, ''));
    } catch {
      return undefined;
    }
    const htmlDirectory = record.htmlPath ? path.dirname(record.htmlPath) : record.outputDirectory;
    const resolved = path.resolve(htmlDirectory, decoded);
    const root = `${path.resolve(record.outputDirectory)}${path.sep}`;
    if (resolved !== path.resolve(record.outputDirectory) && !resolved.startsWith(root)) {
      return undefined;
    }
    return webview.asWebviewUri(vscode.Uri.file(resolved)).toString();
  }

  private postStudio(message: ExtensionToWebviewMessage): Thenable<boolean> | undefined {
    if (!this.webviewReady) {
      return undefined;
    }
    return this.panel?.webview.postMessage({ scope: 'studio', message });
  }

  private shellHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const studioCss = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'studio.css'));
    const aiCss = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'ai.css'));
    const syntaxThemeCss = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'spss-theme.css'));
    const syntaxDataScript = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'spss-syntax-data.js'));
    const highlighterScript = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'spss-highlighter.js'));
    const aiScript = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'ai.js'));
    const variableFilterScript = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'variable-filter.js'));
    const studioScript = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'studio.js'));
    const csp = [
      "default-src 'none'",
      "connect-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const strings = this.studioStrings;
    const text = escapeHtmlText;
    const serializedStrings = JSON.stringify(strings).replace(/</gu, '\\u003c');
    return `<!DOCTYPE html>
<html lang="${vscode.env.language.toLowerCase()}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${studioCss.toString()}" rel="stylesheet">
  <link href="${aiCss.toString()}" rel="stylesheet">
  <link href="${syntaxThemeCss.toString()}" rel="stylesheet">
  <title>SPSS Studio</title>
</head>
<body>
  <header class="toolbar">
    <nav><button id="variables-tab" class="tab">${text(strings.tabVariables)}</button><button id="data-tab" class="tab">${text(strings.tabData)}</button><button id="output-tab" class="tab active">${text(strings.tabOutput)}</button><button id="ai-tab" class="tab">${text(strings.tabChat)}</button></nav>
    <span id="engine-state">${text(strings.enginePrefix)}: ${text(strings.engineStates.stopped)}</span>
  </header>
  <main>
    <section id="output-view" class="view active">
      <div id="output-main">
        <div class="output-actions"><button id="explain-output" disabled>${text(strings.outputExplain)}</button><button id="export-output" disabled>${text(strings.outputExport)}</button><button id="print-output" disabled>${text(strings.outputPrint)}</button><button id="clear-data" disabled title="${text(strings.clearData)}">${text(strings.clear)}</button><button id="toggle-history" type="button" aria-expanded="false">${text(strings.outputHistory)}</button></div>
      <article id="output-content">
        <div id="data-notice" role="status"></div><div id="run-summary" class="summary">${text(strings.noExecutions)}</div><div id="spss-output" class="spss-output"></div>
      </article>
      </div>
      <div id="output-splitter" role="separator" aria-label="${text(strings.resizeRunHistory)}" aria-orientation="vertical" tabindex="0"></div>
      <aside id="output-history"><div class="aside-title"><strong>${text(strings.runs)}</strong><button id="clear-output" title="${text(strings.clearOutput)}">${text(strings.clear)}</button></div><div id="run-history"></div></aside>
    </section>
    <section id="data-view" class="view">
      <div class="data-toolbar"><div id="dataset-summary">${text(strings.noActiveDataset)}</div><button id="refresh-data">${text(strings.refresh)}</button></div>
      <div id="data-scroll" class="table-scroll"><div id="data-canvas"><table id="data-table"></table><table id="data-row-table"></table></div></div>
      <div class="pager"><button id="previous-page">${text(strings.previousRows)}</button><span id="page-summary">—</span><button id="next-page">${text(strings.nextRows)}</button><label>${text(strings.rows)} <select id="page-size"><option>25</option><option>50</option><option selected>100</option><option>200</option><option>500</option></select></label></div>
    </section>
    <section id="variables-view" class="view">
      <div class="data-toolbar variables-toolbar"><div id="variables-summary">${text(strings.noActiveDataset)}</div><div class="variables-actions"><span id="variables-selection">${text(strings.variablesSelected.replace('{count}', '0'))}</span><button id="copy-variables" disabled>${text(strings.copy)}</button><button id="insert-variables" disabled>${text(strings.insert)}</button><button id="refresh-variables">${text(strings.refresh)}</button><span class="explore-control"><button id="explore-variables" disabled>${text(strings.explore)}</button><button id="explore-help" class="explore-help" type="button" aria-label="${text(strings.exploreHelp)}" aria-expanded="false">?</button><span id="explore-help-popover" class="explore-help-popover" role="tooltip" hidden>${text(strings.exploreHelp)}</span></span></div></div>
      <div class="table-scroll"><table id="variables-table"><thead><tr><th class="variable-checkbox-column" aria-label="${text(strings.variableSelection)}"></th><th>#</th><th>${text(strings.name)}</th><th>${text(strings.label)}</th><th>${text(strings.type)}</th><th>${text(strings.format)}</th><th>${text(strings.measure)}</th></tr></thead><tbody></tbody></table></div>
      <div class="pager variables-pager"><button id="previous-variable-page">${text(strings.previous)}</button><span id="variable-page-summary">—</span><button id="next-variable-page">${text(strings.next)}</button><label>${text(strings.rows)} <select id="variable-page-size"><option>25</option><option>50</option><option selected>100</option><option>200</option><option>500</option></select></label><label class="variable-filter-label">${text(strings.filter)} <input id="variable-filter" type="search" placeholder="${text(strings.filterNameOrLabel)}" autocomplete="off" spellcheck="false"></label></div>
    </section>
    <section id="ai-view" class="view">
      <div id="spss-ai">
        <header class="ai-header">
          <nav id="tabs" class="tabs" aria-label="SPSS AI">
            <button type="button" data-page="chat" id="tab-chat"></button>
            <button type="button" data-page="history" id="tab-history"></button>
          </nav>
          <div class="header-actions">
            <label class="profile-selector"><span id="active-profile-label"></span><select id="active-profile"></select></label>
            <button id="new-chat" type="button"></button>
            <button id="manage-profiles" type="button" aria-pressed="false"></button>
          </div>
        </header>
        <div id="banner" class="banner" hidden></div>
        <section id="page-chat" class="page chat-page">
          <div id="messages" aria-live="polite"></div>
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
          <div class="response-language-setting">
            <label for="response-language" id="response-language-label"></label>
            <select id="response-language">
              <option value="zh-CN" id="response-language-zh"></option>
              <option value="en" id="response-language-en"></option>
            </select>
          </div>
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
            <label class="reasoning-setting wide"><input id="reasoning-enabled" type="checkbox"><span id="reasoning-enabled-label"></span></label>
            <div id="reasoning-status" class="key-status wide"></div>
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
      </div>
    </section>
  </main>
  <script nonce="${nonce}">globalThis.SPSS_STUDIO_STRINGS = ${serializedStrings};</script>
  <script nonce="${nonce}" src="${syntaxDataScript.toString()}"></script>
  <script nonce="${nonce}" src="${highlighterScript.toString()}"></script>
  <script nonce="${nonce}" src="${aiScript.toString()}"></script>
  <script nonce="${nonce}" src="${variableFilterScript.toString()}"></script>
  <script nonce="${nonce}" src="${studioScript.toString()}"></script>
</body>
</html>`;
  }
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
