import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  buildOutputExplanationQuestion,
  extractSpssOutputForAi,
  redactOutputPaths,
} from '../ai/outputExplanation';
import type { AiResponseLanguage } from '../ai/chatProtocol';
import { buildJointQuestion } from '../ai/syntaxExplanation';
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
  isStudioFontSize,
  STUDIO_THEMES,
  type StudioTheme,
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
  selectedSyntax: () => string | undefined;
  openQuickStart: () => void;
}

const STUDIO_FONT_KEY = 'spssStudio.fontSize';

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
  private outputSelection: { id: string; blockIds: string[] } | undefined;
  private variableSelection: { revision: number; names: string[] } | undefined;
  private readonly studioStrings = studioStringsForLanguage(vscode.env.language);
  private readonly runtimeStrings = runtimeStringsForLanguage(vscode.env.language);

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputStore: OutputStore,
    private readonly callbacks: SpssStudioPanelCallbacks,
    private readonly aiController: SpssAiPanelController,
    private readonly preferences: vscode.Memento,
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
    this.activeTab = page === 'profiles' ? 'settings' : 'ai';
    panel.reveal(vscode.ViewColumn.Beside, false);
    void this.postStudio({ type: page === 'profiles' ? 'showSettings' : 'showAi' });
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
    this.outputSelection = undefined;
    void this.postStudio({ type: 'outputCleared' });
  }

  public setDataActionsBusy(busy: boolean): void {
    this.dataActionsBusy = busy;
    void this.postStudio({ type: 'dataActionState', busy });
  }

  public dataCleared(): void {
    this.variableSelection = undefined;
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

  public async explainSyntaxWithSelection(syntax: string): Promise<boolean> {
    if (!this.panel?.visible) { return false; }
    const output = this.outputSelection?.id === this.outputStore.selected?.id ? this.outputSelection : undefined;
    const variables = this.variableSelection?.revision === this.datasetRevision ? this.variableSelection : undefined;
    const hasOutput = Boolean(output?.blockIds.length);
    const hasVariables = Boolean(variables?.names.length);
    if (!hasOutput && !hasVariables) { return false; }

    const language = this.aiController.responseLanguage;
    const outputQuestion = output?.blockIds.length ? this.outputQuestion(output.id, output.blockIds, language) : undefined;
    if (hasOutput && !outputQuestion) { return true; }
    const variableQuestion = variables?.names.length
      ? await this.variableQuestion(variables.names, variables.revision, language)
      : undefined;
    if (hasVariables && !variableQuestion) { return true; }
    if (output?.blockIds.length && output.id !== this.outputStore.selected?.id) {
      void vscode.window.showInformationMessage(this.studioStrings.outputSelectionInvalid);
      return true;
    }
    const attachment = [outputQuestion, variableQuestion].filter(Boolean).join('\n\n');
    const kind = outputQuestion && variableQuestion ? 'both' : variableQuestion ? 'variables' : 'output';
    await this.sendAnalysisQuestion(buildJointQuestion(syntax, attachment, kind, language),
      variableQuestion ? 'variableExplore' : 'outputExplain');
    return true;
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
    const configurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('workbench.colorTheme') || event.affectsConfiguration('editor.fontSize')) {
        void this.postSystemSettings();
      }
    });
    panel.onDidDispose(() => {
      configurationListener.dispose();
      if (this.panel === panel) {
        this.panel = undefined;
        this.webviewReady = false;
        this.outputSelection = undefined;
        this.variableSelection = undefined;
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
      } else if (message.type === 'showAi' || message.type === 'showSettings') {
        this.activeTab = message.type === 'showSettings' ? 'settings' : 'ai';
        void this.aiController.refresh();
      } else if (message.type === 'refreshData') {
        void this.callbacks.refreshData();
      } else if (message.type === 'refreshVariables') {
        void this.callbacks.refreshVariables();
      } else if (message.type === 'explainOutput') {
        void this.explainOutput(message.id, message.blockIds,
          message.blockIds?.length ? this.callbacks.selectedSyntax() : undefined);
      } else if (message.type === 'outputSelectionChanged') {
        if (message.id === this.outputStore.selected?.id) { this.outputSelection = message; }
      } else if (message.type === 'variableSelectionChanged') {
        if (message.revision === this.datasetRevision) { this.variableSelection = message; }
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
        void this.exploreVariables(message.names, message.revision,
          message.checked ? this.callbacks.selectedSyntax() : undefined);
      } else if (message.type === 'openQuickStart') {
        this.callbacks.openQuickStart();
      } else if (message.type === 'setStudioTheme') {
        void this.updateSystemSetting(() => this.setStudioTheme(message.theme));
      } else if (message.type === 'setStudioFontSize') {
        void this.updateSystemSetting(() => this.preferences.update(STUDIO_FONT_KEY, message.fontSize));
      } else if (message.type === 'setSpssEditorFontSize') {
        void this.updateSystemSetting(() => vscode.workspace.getConfiguration('editor', { languageId: 'spss' })
          .update('fontSize', message.fontSize ?? undefined, vscode.ConfigurationTarget.Global, true));
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

  private postSystemSettings(): Thenable<boolean> | undefined {
    const fontSize = this.preferences.get(STUDIO_FONT_KEY);
    const editorFontSize = vscode.workspace.getConfiguration('editor', { languageId: 'spss' })
      .inspect<number>('fontSize')?.globalLanguageValue;
    return this.postStudio({
      type: 'systemSettings',
      theme: vscode.workspace.getConfiguration('workbench').get('colorTheme', ''),
      fontSize: isStudioFontSize(fontSize) ? fontSize : null,
      editorFontSize: isStudioFontSize(editorFontSize) ? editorFontSize : null,
    });
  }

  private async setStudioTheme(theme: StudioTheme): Promise<void> {
    if (theme === 'other') {
      await vscode.commands.executeCommand('workbench.action.selectTheme');
    } else {
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', theme, vscode.ConfigurationTarget.Global);
    }
  }

  private async updateSystemSetting(update: () => Thenable<void>): Promise<void> {
    try {
      await update();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`${this.studioStrings.settingsError}: ${message}`);
    } finally {
      await this.postSystemSettings();
    }
  }

  private async postInitialState(): Promise<void> {
    await this.postSystemSettings();
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
      settings: 'showSettings',
    };
    await this.postStudio({ type: showType[this.activeTab] } as ExtensionToWebviewMessage);
  }

  private async selectExecution(id: string): Promise<void> {
    const panel = this.panel;
    if (!panel || !this.outputStore.get(id)) {
      return;
    }
    const record = this.outputStore.select(id);
    const language = vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
    const { presentation, diagnostic } = this.explainableOutput(record, language);
    const html = presentation.html
      ? sanitizeSpssHtml(presentation.html, (source) => this.resolveImage(panel.webview, record, source))
      : '';
    this.selectedHtmlLength = html.length;
    const metadata = this.outputStore.metadata.find((item) => item.id === id);
    if (metadata) {
      await this.postStudio({ type: 'executionSelected', record: metadata, html, diagnostic, blocks: presentation.blocks.map(({ id, title }) => ({ id, title })) });
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

  private explainableOutput(record: ExecutionRecord, language: AiResponseLanguage) {
    const rawHtml = this.outputStore.readHtml(record.id) ?? '';
    if (!record.errorMessage || !['ERROR', 'ENGINE_ERROR', 'TIMEOUT'].includes(record.status)) {
      return { rawHtml, presentation: createSpssOutputBlocks(rawHtml, language), diagnostic: false };
    }
    const label = language === 'en' ? 'SPSS error' : 'SPSS 报错';
    const error = redactOutputPaths(record.errorMessage.slice(0, 4000), language);
    const diagnostic = `<p>${label} (${String(record.errorLevel)}): ${escapeHtmlText(error)}</p>`;
    const withError = /<\/body>/iu.test(rawHtml) ? rawHtml.replace(/<\/body>/iu, () => `${diagnostic}</body>`) : rawHtml + diagnostic;
    return { rawHtml: withError, presentation: createSpssOutputBlocks(withError, language), diagnostic: true };
  }

  private outputQuestion(id: string, blockIds: string[] | undefined, language: AiResponseLanguage): string | undefined {
    const record = this.outputStore.selected;
    if (record?.id !== id || record.status === 'RUNNING') {
      void vscode.window.showInformationMessage(this.studioStrings.outputSelectionInvalid);
      return undefined;
    }
    try {
      const { rawHtml, presentation } = this.explainableOutput(record, language);
      if (blockIds?.length) {
        return buildSelectedOutputQuestion(presentation.blocks, blockIds, language);
      }
      const extracted = extractSpssOutputForAi(rawHtml, language);
      if (!extracted.content) {
        void vscode.window.showInformationMessage(this.runtimeStrings.noExplainableOutput);
        return undefined;
      }
      return buildOutputExplanationQuestion(extracted.content, language);
    } catch {
      void vscode.window.showInformationMessage(this.studioStrings.outputSelectionInvalid);
      return undefined;
    }
  }

  private async explainOutput(id: string, blockIds?: string[], syntax?: string): Promise<void> {
    const language = this.aiController.responseLanguage;
    const question = this.outputQuestion(id, blockIds, language);
    if (question) {
      await this.sendAnalysisQuestion(syntax ? buildJointQuestion(syntax, question, 'output', language) : question, 'outputExplain');
    }
  }

  private async sendAnalysisQuestion(question: string, kind: 'outputExplain' | 'variableExplore'): Promise<void> {
    this.showAi('chat');
    await this.aiController.sendQuestionFromEditor(question, kind);
  }

  private async runVariableAction(action: () => Promise<void>, failureMessage: string): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`${failureMessage}: ${message}`);
    }
  }

  private async variableQuestion(names: string[], revision: number, language: AiResponseLanguage): Promise<string | undefined> {
    if (names.length > 20) {
      void vscode.window.showWarningMessage(this.runtimeStrings.exploreLimit);
      return undefined;
    }
    const available = new Set(this.dataset?.variables.map((variable) => variable.name));
    if (revision !== this.datasetRevision || names.some((name) => !available.has(name))) {
      void vscode.window.showInformationMessage(this.studioStrings.variableReselect);
      return undefined;
    }
    try {
      const profiles = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: this.runtimeStrings.preparingVariableSummaries,
      }, () => this.callbacks.exploreVariables(names));
      if (revision !== this.datasetRevision) {
        void vscode.window.showInformationMessage(this.studioStrings.variableReselect);
        return undefined;
      }
      return buildVariableExploreQuestion(profiles, language);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`${this.runtimeStrings.exploreVariablesFailed}: ${message}`);
      return undefined;
    }
  }

  private async exploreVariables(names: string[], revision: number, syntax?: string): Promise<void> {
    try {
      const language = this.aiController.responseLanguage;
      const question = await this.variableQuestion(names, revision, language);
      if (question) {
        await this.sendAnalysisQuestion(syntax ? buildJointQuestion(syntax, question, 'variables', language) : question, 'variableExplore');
      }
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
        const language = vscode.env.language.startsWith('zh') ? 'zh-CN' : 'en';
        rawHtml = buildSelectedOutputHtml(this.explainableOutput(record, language).rawHtml, blockIds, language);
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

  private fontControls(id: 'spss-editor' | 'studio', label: string): string {
    const fallback = escapeHtmlText(this.studioStrings.defaultFontSize);
    const presets = escapeHtmlText(this.studioStrings.fontSizePresets);
    const options = [10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28]
      .map((size) => `<option value="${String(size)}">${String(size)}</option>`).join('');
    return `<label for="${id}-font-size">${escapeHtmlText(label)}</label>
      <div class="font-control">
        <input id="${id}-font-size" type="text" inputmode="numeric" maxlength="2" placeholder="${fallback}" autocomplete="off">
        <select id="${id}-font-presets" aria-label="${escapeHtmlText(label)} · ${presets}">
          <option value="" disabled selected hidden>${presets}</option>
          ${options}
        </select>
        <button id="reset-${id}-font" type="button">${fallback}</button>
      </div>`;
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
    <nav><button id="variables-tab" class="tab">${text(strings.tabVariables)}</button><button id="data-tab" class="tab">${text(strings.tabData)}</button><button id="output-tab" class="tab active">${text(strings.tabOutput)}</button><button id="ai-tab" class="tab">${text(strings.tabChat)}</button><button id="settings-tab" class="tab">${text(strings.tabSettings)}</button></nav>
    <span id="engine-state">${text(strings.enginePrefix)}: ${text(strings.engineStates.stopped)}</span>
  </header>
  <main id="studio-views">
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
          <label class="profile-selector"><span id="active-profile-label"></span><select id="active-profile"></select></label>
          <nav id="tabs" class="tabs" aria-label="SPSS AI">
            <button id="new-chat" type="button"></button>
            <button type="button" data-page="chat" id="tab-chat"></button>
            <button type="button" data-page="history" id="tab-history"></button>
          </nav>
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
      </div>
    </section>
    <section id="settings-view" class="view">
      <div id="settings-banner" class="banner" role="status" hidden></div>
      <section id="page-profiles" class="profiles-page">
          <aside class="profiles-sidebar">
            <button id="system-settings" type="button" class="profile-row" aria-controls="system-form" aria-pressed="false">${text(strings.systemSettings)}</button>
            <button id="new-profile" type="button"></button>
            <div id="profile-list" class="profile-list"></div>
          </aside>
          <section id="system-form" class="system-form" hidden>
            <button id="open-quick-start" type="button">${text(strings.quickStart)}</button>
            <label for="studio-theme">${text(strings.theme)}</label>
            <select id="studio-theme">
              <option value="${STUDIO_THEMES[0]}">${text(strings.lightTheme)}</option>
              <option value="${STUDIO_THEMES[1]}">${text(strings.darkTheme)}</option>
              <option value="other">${text(strings.otherThemes)}</option>
            </select>
            ${this.fontControls('spss-editor', strings.spssEditorFontSize)}
            ${this.fontControls('studio', strings.studioFontSize)}
            <label for="response-language" id="response-language-label"></label>
            <select id="response-language">
              <option value="zh-CN" id="response-language-zh"></option>
              <option value="en" id="response-language-en"></option>
            </select>
          </section>
          <form id="profile-form" class="profile-form">
            <label><span id="profile-name-label"></span><input id="profile-name" type="text" maxlength="120" autocomplete="off"></label>
            <label><span id="provider-label"></span><select id="provider"></select></label>
            <label class="wide"><span id="base-url-label"></span><input id="base-url" type="url" autocomplete="off"></label>
            <label><span id="model-label"></span><input id="model" type="text" autocomplete="off"></label>
            <label><span id="api-key-label"></span><input id="api-key" type="password" autocomplete="off"></label>
            <div class="profile-options wide">
              <label class="reasoning-setting"><input id="reasoning-enabled" type="checkbox"><span id="reasoning-enabled-label"></span></label>
              <label class="reasoning-setting"><input id="coding-enabled" type="checkbox" aria-describedby="coding-hint"><span id="coding-enabled-label"></span></label>
            </div>
            <div id="coding-hint" class="key-status wide"></div>
            <div id="reasoning-status" class="key-status wide"></div>
            <div id="key-status" class="key-status wide"></div>
            <div class="profile-actions wide">
              <button id="save-profile" type="submit"></button>
              <button id="test-profile" type="button"></button>
              <button id="make-active" type="button"></button>
              <button id="delete-profile" type="button"></button>
              <button id="provider-help" type="button"></button>
            </div>
            <div id="profile-test-status" class="key-status wide" role="status"></div>
          </form>
      </section>
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
