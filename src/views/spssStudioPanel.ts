import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ActiveDatasetInfo, DatasetPage, EngineState } from '../spss/types';
import { sanitizeSpssHtml } from './htmlSanitizer';
import { normalizeVariableWindow } from './dataViewportState';
import type { ExecutionRecord, OutputStore } from './outputStore';
import { buildPortableOutputHtml } from './portableOutput';
import {
  isWebviewMessage,
  type DatasetPageUiRequest,
  type ExtensionToWebviewMessage,
} from './webviewProtocol';

export interface SpssStudioPanelCallbacks {
  requestDatasetPage: (page: DatasetPageUiRequest) => Promise<void>;
  refreshData: () => Promise<void>;
  refreshVariables: () => Promise<void>;
  clearOutput: () => void;
}

export class SpssStudioPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private activeTab: 'output' | 'data' | 'variables' = 'output';
  private dataset: ActiveDatasetInfo | undefined;
  private datasetRevision = 0;
  private page: DatasetPage | undefined;
  private pageRequest = { requestId: 0, generation: 0 };
  private selectedHtmlLength = 0;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly outputStore: OutputStore,
    private readonly callbacks: SpssStudioPanelCallbacks,
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
    void this.post({ type: 'showOutput' });
    void this.postSelected();
  }

  public showData(): void {
    const panel = this.ensurePanel();
    this.activeTab = 'data';
    panel.reveal(vscode.ViewColumn.Beside, true);
    void this.post({ type: 'showData' });
    void this.post({ type: 'datasetMetadata', dataset: this.dataset ?? null, revision: this.datasetRevision });
    if (this.page) {
      void this.post({ type: 'datasetPage', page: this.page, ...this.pageRequest });
    } else {
      void this.callbacks.refreshData();
    }
  }

  public showVariables(): void {
    const panel = this.ensurePanel();
    this.activeTab = 'variables';
    panel.reveal(vscode.ViewColumn.Beside, true);
    void this.post({ type: 'showVariables' });
    void this.post({ type: 'datasetMetadata', dataset: this.dataset ?? null, revision: this.datasetRevision });
    if (!this.dataset) {
      void this.callbacks.refreshVariables();
    }
  }

  public executionStarted(record: ExecutionRecord): void {
    this.showOutput();
    void this.post({ type: 'executionStarted', history: this.outputStore.metadata, selectedId: record.id });
  }

  public executionCompleted(record: ExecutionRecord): void {
    void this.post({ type: 'executionCompleted', history: this.outputStore.metadata, selectedId: record.id });
    void this.selectExecution(record.id);
  }

  public setDatasetMetadata(dataset: ActiveDatasetInfo | undefined): void {
    this.dataset = dataset;
    this.datasetRevision += 1;
    void this.post({ type: 'datasetMetadata', dataset: dataset ?? null, revision: this.datasetRevision });
  }

  public setDatasetPage(page: DatasetPage, requestId = 0, generation = 0): void {
    this.page = page;
    this.pageRequest = { requestId, generation };
    void this.post({ type: 'datasetPage', page, requestId, generation });
  }

  public clearDatasetPage(): void {
    this.page = undefined;
  }

  public setEngineState(state: EngineState): void {
    void this.post({ type: 'engineState', state });
  }

  public outputCleared(): void {
    void this.post({ type: 'outputCleared' });
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) {
      return this.panel;
    }
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      'spssStudio',
      'SPSS Studio',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot, vscode.Uri.file(this.outputStore.sessionRoot)],
      },
    );
    panel.webview.html = this.shellHtml(panel.webview, mediaRoot);
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
      }
    });
    panel.onDidChangeViewState(() => {
      if (panel.visible && this.activeTab === 'data' && !this.page) {
        void this.callbacks.refreshData();
      } else if (panel.visible && this.activeTab === 'variables' && !this.dataset) {
        void this.callbacks.refreshVariables();
      }
    });
    panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!isWebviewMessage(message)) {
        return;
      }
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
      } else if (message.type === 'refreshData') {
        void this.callbacks.refreshData();
      } else if (message.type === 'refreshVariables') {
        void this.callbacks.refreshVariables();
      } else if (message.type === 'exportOutput') {
        void this.exportOutput(message.id);
      } else if (message.type === 'printOutput') {
        void this.printOutput(message.id);
      } else {
        this.callbacks.clearOutput();
      }
    });
    this.panel = panel;
    void this.post({ type: 'engineState', state: 'stopped' });
    void this.post({ type: 'datasetMetadata', dataset: this.dataset ?? null, revision: this.datasetRevision });
    return panel;
  }

  private async selectExecution(id: string): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const record = this.outputStore.select(id);
    const rawHtml = this.outputStore.readHtml(id) ?? '';
    const html = record.htmlPath
      ? sanitizeSpssHtml(rawHtml, (source) => this.resolveImage(panel.webview, record, source))
      : '';
    this.selectedHtmlLength = html.length;
    const metadata = this.outputStore.metadata.find((item) => item.id === id);
    if (metadata) {
      await this.post({ type: 'executionSelected', record: metadata, html });
    }
  }

  private async postSelected(): Promise<void> {
    const selected = this.outputStore.selected;
    if (selected) {
      await this.selectExecution(selected.id);
    }
  }

  private async exportOutput(id: string): Promise<void> {
    const source = this.outputSource(id);
    if (!source) {
      return;
    }
    const timestamp = source.record.timestamp.replace(/[-:]/gu, '').replace(/\..+$/u, '').replace('T', '-');
    const fileName = `SPSS-output-run-${String(source.record.sequence)}-${timestamp}.html`;
    const options: vscode.SaveDialogOptions = {
      filters: { HTML: ['html'] },
      saveLabel: 'Export SPSS HTML',
    };
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspace) {
      options.defaultUri = vscode.Uri.joinPath(workspace, fileName);
    }
    const target = await vscode.window.showSaveDialog(options);
    if (!target) {
      return;
    }
    try {
      const html = buildPortableOutputHtml(
        source.rawHtml,
        source.record.outputDirectory,
        source.record.htmlPath,
      );
      await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
      void vscode.window.showInformationMessage(`SPSS output exported to ${target.fsPath || target.toString()}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not export SPSS output: ${message}`);
    }
  }

  private async printOutput(id: string): Promise<void> {
    const source = this.outputSource(id);
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
      const printPath = path.join(source.record.outputDirectory, 'print.html');
      await fs.promises.writeFile(printPath, html, 'utf8');
      const opened = await vscode.env.openExternal(vscode.Uri.file(printPath));
      if (!opened) {
        void vscode.window.showErrorMessage('The system did not open the printable SPSS output.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not prepare SPSS output for printing: ${message}`);
    }
  }

  private outputSource(id: string): { record: ExecutionRecord & { htmlPath: string }; rawHtml: string } | undefined {
    const record = this.outputStore.get(id);
    if (!record?.htmlPath || record.status === 'RUNNING') {
      void vscode.window.showInformationMessage('The selected run has no HTML output to export or print.');
      return undefined;
    }
    const rawHtml = this.outputStore.readHtml(id);
    if (rawHtml === undefined) {
      void vscode.window.showErrorMessage('The selected SPSS HTML output file is no longer available.');
      return undefined;
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

  private post(message: ExtensionToWebviewMessage): Thenable<boolean> | undefined {
    return this.panel?.webview.postMessage(message);
  }

  private shellHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'studio.css'));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'studio.js'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${css.toString()}" rel="stylesheet">
  <title>SPSS Studio</title>
</head>
<body>
  <header class="toolbar">
    <nav><button id="output-tab" class="tab active">Output</button><button id="data-tab" class="tab">Data</button><button id="variables-tab" class="tab">Variables</button></nav>
    <span id="engine-state">SPSS: Stopped</span>
  </header>
  <main>
    <section id="output-view" class="view active">
      <article id="output-content">
        <div class="output-actions"><button id="export-output" disabled>Export HTML</button><button id="print-output" disabled>Print</button></div>
        <div id="run-summary" class="summary">No executions yet.</div><div id="spss-output" class="spss-output"></div>
      </article>
      <div id="output-splitter" role="separator" aria-label="Resize run history" aria-orientation="vertical" tabindex="0"></div>
      <aside id="output-history"><div class="aside-title"><strong>Runs</strong><button id="clear-output" title="Clear output">Clear</button></div><div id="run-history"></div></aside>
    </section>
    <section id="data-view" class="view">
      <div class="data-toolbar"><div id="dataset-summary">No Active Dataset.</div><button id="refresh-data">Refresh</button></div>
      <div id="data-scroll" class="table-scroll"><div id="data-canvas"><table id="data-table"></table><table id="data-row-table"></table></div></div>
      <div class="pager"><button id="previous-page">Previous rows</button><span id="page-summary">—</span><button id="next-page">Next rows</button><label>Rows <select id="page-size"><option>25</option><option>50</option><option selected>100</option><option>200</option><option>500</option></select></label></div>
    </section>
    <section id="variables-view" class="view">
      <div class="data-toolbar"><div id="variables-summary">No Active Dataset.</div><button id="refresh-variables">Refresh</button></div>
      <div class="table-scroll"><table id="variables-table"><thead><tr><th>#</th><th>Name</th><th>Label</th><th>Type</th><th>Format</th><th>Measure</th></tr></thead><tbody></tbody></table></div>
      <div class="pager"><button id="previous-variable-page">Previous variables</button><span id="variable-page-summary">—</span><button id="next-variable-page">Next variables</button><label>Rows <select id="variable-page-size"><option>25</option><option>50</option><option selected>100</option><option>200</option><option>500</option></select></label></div>
    </section>
  </main>
  <script nonce="${nonce}" src="${script.toString()}"></script>
</body>
</html>`;
  }
}
