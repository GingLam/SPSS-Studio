import * as vscode from 'vscode';
import { AiSessionController } from './ai/aiSessionController';
import { ConversationStore } from './ai/conversationStore';
import { migrateLegacyProviderConfiguration } from './ai/modelProfileMigration';
import { ModelProfileStore } from './ai/modelProfileStore';
import { OpenAiCompatibleClient } from './ai/openAiCompatibleClient';
import { explainSelectionOrCurrentCommand } from './commands/aiCommands';
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
import { insertCachedVariable } from './commands/variableCommands';
import { SpssEditorTargetTracker } from './editor/spssEditorTargetTracker';
import { SpssCompletionProvider } from './language/completionProvider';
import { loadLanguageSchema } from './language/languageSchema';
import { EngineService, type SpssRuntimeConfiguration } from './spss/engineService';
import { VariableCache } from './spss/variableCache';
import type { EngineState } from './spss/types';
import { StudioSession } from './studioSession';
import { OutputStore } from './views/outputStore';
import { SpssAiPanelController } from './views/spssAiPanelController';
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
  const editorTarget = new SpssEditorTargetTracker();
  const variableCommandDependencies = { variableCache, editorTarget };
  const modelProfiles = new ModelProfileStore(context.globalState, context.secrets);
  const conversationStore = new ConversationStore(
    vscode.Uri.joinPath(context.globalStorageUri, 'ai-history').fsPath,
    {
      onWarning: (message) => {
        void vscode.window.showWarningMessage(message);
      },
    },
  );
  const aiInitialization = migrateLegacyProviderConfiguration(
    context.globalState,
    context.secrets,
    modelProfiles,
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`SPSS AI configuration migration failed: ${message}`);
  });
  const aiPanelController = new SpssAiPanelController(
    new AiSessionController(modelProfiles, conversationStore, new OpenAiCompatibleClient()),
    {
      insertCode: (code) => editorTarget.insert(code),
      showWarning: (message) => {
        void vscode.window.showWarningMessage(message);
      },
      writeClipboard: (code) => vscode.env.clipboard.writeText(code),
      openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
      confirm: async (message, action) => {
        const choice = await vscode.window.showWarningMessage(message, { modal: true }, action);
        return choice === action;
      },
      requireTrustedWorkspace: async (strings) => {
        if (vscode.workspace.isTrusted) {
          return true;
        }
        const choice = await vscode.window.showWarningMessage(
          strings.untrustedWorkspace,
          strings.manageWorkspaceTrust,
        );
        if (choice === strings.manageWorkspaceTrust) {
          await vscode.commands.executeCommand('workbench.trust.manage');
        }
        return false;
      },
    },
    context.globalState,
    aiInitialization,
    vscode.env.language,
  );
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
    insertVariable: async (name) => insertCachedVariable(variableCommandDependencies, name),
    clearOutput: () => studioHolder.current?.clearOutput(),
  }, aiPanelController);
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
  context.subscriptions.push(
    output,
    statusBar,
    outputStore,
    studioPanel,
    variableCache,
    editorTarget,
    aiPanelController,
    vscode.languages.registerCompletionItemProvider('spss', completionProvider, '/', '.'),
    vscode.commands.registerCommand('spssStudio.undo', undoLastEdit),
    vscode.commands.registerCommand(
      'spssStudio.runSelection',
      async () => runSelectionOrCurrentCommand(executionDependencies),
    ),
    vscode.commands.registerCommand('spssStudio.runFile', async () => runFile(executionDependencies)),
    vscode.commands.registerCommand('spssStudio.explainSyntaxInChat', async () => {
      await explainSelectionOrCurrentCommand({
        showChat: () => studioPanel?.showAi('chat'),
        sendQuestion: (question) => aiPanelController.sendQuestionFromEditor(question),
        responseLanguage: () => aiPanelController.responseLanguage,
      });
    }),
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
    vscode.commands.registerCommand('spssStudio.showAi', () => studioPanel?.showAi('chat')),
    vscode.commands.registerCommand('spssStudio.configureAi', () => studioPanel?.showAi('profiles')),
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
