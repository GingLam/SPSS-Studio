import * as vscode from 'vscode';
import type { EngineService, SpssRuntimeConfiguration } from './spss/engineService';
import { shouldRefreshDatasetMetadata } from './spss/executionResult';
import type {
  BridgeResponse,
  DatasetPageRequest,
  EngineState,
  ExecutionStatus,
  VariableProfiles,
} from './spss/types';
import type { VariableCache } from './spss/variableCache';
import { DataPreviewState } from './views/dataPreviewState';
import type { OutputStore } from './views/outputStore';
import type { SpssStudioPanel } from './views/spssStudioPanel';
import type { DatasetPageUiRequest } from './views/webviewProtocol';

export class StudioSession {
  private readonly dataPreview: DataPreviewState;

  public constructor(
    private readonly engine: EngineService,
    private readonly variableCache: VariableCache,
    private readonly outputStore: OutputStore,
    private readonly panel: SpssStudioPanel,
    private readonly diagnosticOutput: vscode.OutputChannel,
    private readonly getConfiguration: () => SpssRuntimeConfiguration,
  ) {
    this.dataPreview = new DataPreviewState(getConfiguration().dataPreviewPageSize);
  }

  public get historyCount(): number {
    return this.outputStore.metadata.length;
  }

  public get variableCount(): number {
    return this.variableCache.variables.length;
  }

  public async execute(syntax: string, label: string): Promise<void> {
    const { record, target } = this.outputStore.begin(label);
    this.panel.executionStarted(record);
    this.diagnosticOutput.appendLine(`SPSS ${label} started as Run #${String(record.sequence)}.`);
    try {
      const response = await this.engine.run(syntax, target, this.getConfiguration());
      const completed = this.outputStore.complete(record.id, response);
      this.panel.executionCompleted(completed);
      this.appendDiagnostic(completed.sequence, response);
      if (shouldRefreshDatasetMetadata(response)) {
        await this.refreshMetadata(this.panel.dataVisible);
      }
    } catch (error) {
      const status: ExecutionStatus = error instanceof Error && /timed out/iu.test(error.message)
        ? 'TIMEOUT'
        : 'ENGINE_ERROR';
      const failed = this.outputStore.fail(record.id, error, status);
      this.panel.executionCompleted(failed);
      const message = error instanceof Error ? error.message : String(error);
      this.diagnosticOutput.appendLine(`SPSS Run #${String(record.sequence)} failed: ${message}`);
      void vscode.window.showErrorMessage(`SPSS execution failed: ${message}`);
    }
  }

  public showOutput(): void {
    this.panel.showOutput();
  }

  public showData(): void {
    this.panel.showData();
  }

  public showVariables(): void {
    this.panel.showVariables();
  }

  public async refreshData(): Promise<void> {
    await this.refreshMetadata(false);
    if (this.variableCache.info?.active) {
      await this.requestDatasetPage(this.dataPreview.current);
    }
  }

  public async refreshVariables(): Promise<void> {
    await this.refreshMetadata(false);
  }

  public async variableProfiles(variableNames: readonly string[]): Promise<VariableProfiles> {
    const available = new Map(this.variableCache.variables.map((variable) => [variable.name, variable.index]));
    const unique = [...new Set(variableNames)];
    if (unique.length === 0 || unique.length > 20) {
      throw new Error('Explore requires between 1 and 20 variables.');
    }
    for (const name of unique) {
      if (!available.has(name)) {
        throw new Error(`Variable ${name} is no longer available in the Active Dataset.`);
      }
    }
    unique.sort((left, right) => (available.get(left) ?? 0) - (available.get(right) ?? 0));
    return this.engine.variableProfiles(unique, this.getConfiguration());
  }

  public async requestDatasetPage(request: DatasetPageRequest | DatasetPageUiRequest): Promise<void> {
    const normalized = this.dataPreview.update(request);
    try {
      const page = await this.engine.datasetPage(normalized, this.getConfiguration());
      const requestId = 'requestId' in request ? request.requestId : 0;
      const generation = 'generation' in request ? request.generation : 0;
      this.panel.setDatasetPage(page, requestId, generation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.diagnosticOutput.appendLine(`SPSS data preview failed: ${message}`);
      void vscode.window.showErrorMessage(`Could not read Active Dataset page: ${message}`);
    }
  }

  public clearOutput(): void {
    this.outputStore.clear();
    this.panel.outputCleared();
  }

  public handleEngineState(state: EngineState): void {
    this.panel.setEngineState(state);
    if (state === 'stopped' || state === 'starting' || state === 'error') {
      this.variableCache.clear();
      this.dataPreview.reset();
      this.panel.clearDatasetPage();
      this.panel.setDatasetMetadata(undefined);
    }
  }

  private async refreshMetadata(loadPage: boolean): Promise<void> {
    try {
      const info = await this.engine.datasetInfo(this.getConfiguration());
      this.variableCache.replace(info);
      this.panel.setDatasetMetadata(info.active ? info : undefined);
      if (!info.active) {
        this.panel.clearDatasetPage();
      } else if (loadPage) {
        await this.requestDatasetPage(this.dataPreview.current);
      }
    } catch (error) {
      this.variableCache.clear();
      this.panel.clearDatasetPage();
      this.panel.setDatasetMetadata(undefined);
      this.diagnosticOutput.appendLine(`SPSS dataset metadata refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private appendDiagnostic(sequence: number, response: BridgeResponse): void {
    this.diagnosticOutput.appendLine(
      `SPSS Run #${String(sequence)}: ${response.status ?? (response.ok ? 'SUCCESS' : 'ERROR')} · error level ${String(response.errorLevel)} · ${String(response.durationMs)} ms.`,
    );
    if (response.error) {
      this.diagnosticOutput.appendLine(`SPSS Run #${String(sequence)} message: ${response.error}`);
    }
    if (response.status === 'ERROR' && response.engineAlive !== false) {
      this.diagnosticOutput.appendLine(
        `SPSS Run #${String(sequence)} note: earlier commands may have changed the Active Dataset; SPSS does not roll back a partially failed submission.`,
      );
    }
    for (const warning of response.warnings) {
      this.diagnosticOutput.appendLine(`SPSS Run #${String(sequence)} bridge warning: ${warning}`);
    }
  }
}
