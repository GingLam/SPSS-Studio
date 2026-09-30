import * as vscode from 'vscode';
import type { EngineService, SpssRuntimeConfiguration } from '../spss/engineService';
import { requireTrustedWorkspace } from './workspaceTrust';

export interface EngineCommandDependencies {
  engine: EngineService;
  output: vscode.OutputChannel;
  getConfiguration: () => SpssRuntimeConfiguration;
}

function appendStatus(dependencies: EngineCommandDependencies): void {
  const status = dependencies.engine.status();
  const installation = status.installation;
  dependencies.output.appendLine('=== SPSS Engine Status ===');
  dependencies.output.appendLine(`Platform: ${process.platform}`);
  dependencies.output.appendLine(`State: ${status.state}`);
  dependencies.output.appendLine(`Engine alive: ${status.engineAlive ? 'yes' : 'no'}`);
  dependencies.output.appendLine(`SPSS version: ${installation?.version ?? 'not detected'}`);
  dependencies.output.appendLine(`Install path: ${installation?.installRoot ?? 'not detected'}`);
  dependencies.output.appendLine(`Python launcher: ${installation?.pythonLauncher ?? 'not detected'}`);
  dependencies.output.appendLine(`Last error: ${status.lastError ?? 'none'}`);
  dependencies.output.appendLine('');
}

export async function startEngine(dependencies: EngineCommandDependencies): Promise<void> {
  if (!(await requireTrustedWorkspace())) {
    return;
  }
  dependencies.output.show(true);
  dependencies.output.appendLine('Starting IBM SPSS Statistics engine…');
  try {
    await dependencies.engine.start(dependencies.getConfiguration());
    dependencies.output.appendLine('SPSS engine is ready.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.output.appendLine(`[Error] ${message}`);
    void vscode.window.showErrorMessage(`Could not start SPSS: ${message}`);
  }
  appendStatus(dependencies);
}

export async function stopEngine(dependencies: EngineCommandDependencies): Promise<void> {
  await dependencies.engine.stop();
  dependencies.output.appendLine('SPSS engine stopped.');
}

export async function restartEngine(dependencies: EngineCommandDependencies): Promise<void> {
  if (!(await requireTrustedWorkspace())) {
    return;
  }
  dependencies.output.show(true);
  dependencies.output.appendLine('Restarting IBM SPSS Statistics engine…');
  try {
    await dependencies.engine.restart(dependencies.getConfiguration());
    dependencies.output.appendLine('SPSS engine restarted and is ready.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.output.appendLine(`[Error] ${message}`);
    void vscode.window.showErrorMessage(`Could not restart SPSS: ${message}`);
  }
}

export function showStatus(dependencies: EngineCommandDependencies): void {
  appendStatus(dependencies);
  dependencies.output.show(true);
}
