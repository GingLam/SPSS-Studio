import * as vscode from 'vscode';
import {
  restartEngine,
  showStatus,
  startEngine,
  stopEngine,
  type EngineCommandDependencies,
} from './commands/engineCommands';
import {
  runFile,
  runSelectionOrCurrentCommand,
  type ExecutionCommandDependencies,
} from './commands/executionCommands';
import { requireTrustedWorkspace } from './commands/workspaceTrust';
import { undoLastEdit } from './commands/editorCommands';
import { insertVariable, showVariablePicker } from './commands/variableCommands';
import { SpssEditorTargetTracker } from './editor/spssEditorTargetTracker';
import { SpssCompletionProvider } from './language/completionProvider';
import { loadLanguageSchema } from './language/languageSchema';
import { SpssVariableInlayProvider } from './language/variableInlayProvider';
import { EngineService, type SpssRuntimeConfiguration } from './spss/engineService';
import { VariableCache } from './spss/variableCache';
import type { EngineState } from './spss/types';
import { StudioSession } from './studioSession';
import { OutputStore } from './views/outputStore';
import { SpssStudioPanel } from './views/spssStudioPanel';

let engineService: EngineService | undefined;
let outputStore: OutputStore | undefined;
let studioPanel: SpssStudioPanel | undefined;

export interface SpssStudioExtensionApi {
  getStatusBarText(): string;
  getEngineState(): EngineState;
  getOutputHistoryCount(): number;
  getVariableCount(): number;
  getSelectedOutput(): { status: string; hasHtml: boolean; renderedLength: number } | undefined;
  getDataPageSummary(): { rows: number; variables: number; totalCases: number } | undefined;
  outputChannelName: string;
}

function readConfiguration(): SpssRuntimeConfiguration {
  const configuration = vscode.workspace.getConfiguration('spssStudio');
  return {
    installPath: configuration.get<string>('installPath', ''),
    pythonLauncherPath: configuration.get<string>('pythonLauncherPath', ''),
    startupTimeoutSeconds: configuration.get<number>('startupTimeoutSeconds', 45),
    executionTimeoutSeconds: configuration.get<number>('executionTimeoutSeconds', 300),
    dataPreviewPageSize: configuration.get<number>('dataPreviewPageSize', 100),
    autoStart: configuration.get<boolean>('autoStart', true),
    debugLogging: configuration.get<boolean>('debugLogging', false),
  };
}

function statusText(state: EngineState): string {
  const labels: Record<EngineState, string> = {
    stopped: 'Stopped',
    starting: 'Starting…',
    ready: 'Ready',
    running: 'Running…',
    error: 'Error',
  };
  return `$(database) SPSS: ${labels[state]}`;
}

export function activate(context: vscode.ExtensionContext): SpssStudioExtensionApi {
  const output = vscode.window.createOutputChannel('SPSS');
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'spssStudio.showStatus';
  statusBar.tooltip = 'Show IBM SPSS Statistics engine status';

  let state: EngineState = 'stopped';
  const studioHolder: { current?: StudioSession } = {};
  const updateStatus = (newState: EngineState): void => {
    state = newState;
    statusBar.text = statusText(newState);
    statusBar.backgroundColor = newState === 'error'
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : undefined;
    statusBar.show();
    studioHolder.current?.handleEngineState(newState);
  };

  engineService = new EngineService(context.extensionPath, {
    onStateChange: updateStatus,
    onDiagnostic: (message) => {
      const configuration = readConfiguration();
      if (configuration.debugLogging) {
        output.appendLine(`[Bridge] ${message}`);
      }
    },
  });
  const variableCache = new VariableCache();
  outputStore = new OutputStore();
  studioPanel = new SpssStudioPanel(context.extensionUri, outputStore, {
    requestDatasetPage: async (page) => {
      if (await requireTrustedWorkspace()) {
        await studioHolder.current?.requestDatasetPage(page);
      }
    },
    refreshData: async () => {
      if (await requireTrustedWorkspace()) {
        await studioHolder.current?.refreshData();
      }
    },
    refreshVariables: async () => {
      if (await requireTrustedWorkspace()) {
        await studioHolder.current?.refreshVariables();
      }
    },
    clearOutput: () => studioHolder.current?.clearOutput(),
  });
  const studio = new StudioSession(
    engineService,
    variableCache,
    outputStore,
    studioPanel,
    output,
    readConfiguration,
  );
  studioHolder.current = studio;
  updateStatus('stopped');

  const executionDependencies: ExecutionCommandDependencies = {
    studio,
  };
  const engineDependencies: EngineCommandDependencies = {
    engine: engineService,
    output,
    getConfiguration: readConfiguration,
  };
  const completionProvider = new SpssCompletionProvider(
    loadLanguageSchema(context.extensionPath),
    variableCache,
  );
  const editorTarget = new SpssEditorTargetTracker();
  const variableInlayProvider = new SpssVariableInlayProvider(variableCache);
  const variableCommandDependencies = { variableCache, editorTarget };

  context.subscriptions.push(
    output,
    statusBar,
    outputStore,
    studioPanel,
    variableCache,
    editorTarget,
    variableInlayProvider,
    vscode.languages.registerCompletionItemProvider('spss', completionProvider, '/', '.'),
    vscode.languages.registerInlayHintsProvider('spss', variableInlayProvider),
    vscode.commands.registerCommand('spssStudio.undo', undoLastEdit),
    vscode.commands.registerCommand(
      'spssStudio.runSelection',
      async () => runSelectionOrCurrentCommand(executionDependencies),
    ),
    vscode.commands.registerCommand('spssStudio.runFile', async () => runFile(executionDependencies)),
    vscode.commands.registerCommand('spssStudio.startEngine', async () => startEngine(engineDependencies)),
    vscode.commands.registerCommand('spssStudio.stopEngine', async () => stopEngine(engineDependencies)),
    vscode.commands.registerCommand('spssStudio.restartEngine', async () => restartEngine(engineDependencies)),
    vscode.commands.registerCommand('spssStudio.showStatus', () => showStatus(engineDependencies)),
    vscode.commands.registerCommand('spssStudio.showOutput', () => studio.showOutput()),
    vscode.commands.registerCommand('spssStudio.showData', async () => {
      if (await requireTrustedWorkspace()) {
        studio.showData();
      }
    }),
    vscode.commands.registerCommand('spssStudio.showVariables', async () => {
      if (await requireTrustedWorkspace()) {
        studio.showVariables();
      }
    }),
    vscode.commands.registerCommand('spssStudio.refreshDataPreview', async () => {
      if (await requireTrustedWorkspace()) {
        await studio.refreshData();
      }
    }),
    vscode.commands.registerCommand('spssStudio.clearOutput', () => studio.clearOutput()),
    vscode.commands.registerCommand(
      'spssStudio.insertVariable',
      async (variableName: unknown) => insertVariable(variableCommandDependencies, variableName),
    ),
    vscode.commands.registerCommand(
      'spssStudio.showVariablePicker',
      async () => showVariablePicker(variableCommandDependencies),
    ),
  );

  return {
    getStatusBarText: () => statusBar.text,
    getEngineState: () => state,
    getOutputHistoryCount: () => studio.historyCount,
    getVariableCount: () => studio.variableCount,
    getSelectedOutput: () => {
      const selected = outputStore?.selected;
      return selected
        ? { status: selected.status, hasHtml: selected.htmlPath !== undefined, renderedLength: studioPanel?.renderedOutputLength ?? 0 }
        : undefined;
    },
    getDataPageSummary: () => studioPanel?.currentPageSummary,
    outputChannelName: output.name,
  };
}

export async function deactivate(): Promise<void> {
  await engineService?.stop();
  studioPanel?.dispose();
  outputStore?.dispose();
  engineService = undefined;
  studioPanel = undefined;
  outputStore = undefined;
}
