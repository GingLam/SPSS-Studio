import assert from 'node:assert/strict';
import path from 'node:path';
import * as vscode from 'vscode';
import type { SpssStudioExtensionApi } from '../../src/extension';

async function waitFor<T>(read: () => T | undefined, description: string): Promise<T> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

describe('SPSS Studio real SPSS Extension Host', () => {
  it('runs SPSS, renders OMS HTML, refreshes variables, and lazily loads a dataset page', async () => {
    const installRoot = process.env.SPSS_STUDIO_REAL_INSTALL_ROOT;
    const launcher = process.env.SPSS_STUDIO_REAL_LAUNCHER;
    const workspace = process.env.SPSS_STUDIO_REAL_WORKSPACE;
    assert.ok(installRoot && launcher && workspace);

    const configuration = vscode.workspace.getConfiguration('spssStudio');
    await configuration.update('installPath', installRoot, vscode.ConfigurationTarget.Workspace);
    await configuration.update('pythonLauncherPath', launcher, vscode.ConfigurationTarget.Workspace);
    await configuration.update('startupTimeoutSeconds', 120, vscode.ConfigurationTarget.Workspace);
    await configuration.update('executionTimeoutSeconds', 120, vscode.ConfigurationTarget.Workspace);
    await configuration.update('autoStart', true, vscode.ConfigurationTarget.Workspace);

    const extension = vscode.extensions.getExtension<SpssStudioExtensionApi>('ginglam.spss-studio');
    assert.ok(extension);
    const api = await extension.activate();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace, 'real.sps')));
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('spssStudio.runFile');

    assert.equal(api.getEngineState(), 'ready');
    assert.equal(api.getOutputHistoryCount(), 1);
    assert.equal(api.getVariableCount(), 3);
    const output = api.getSelectedOutput();
    assert.ok(output);
    assert.equal(output.status, 'SUCCESS');
    assert.equal(output.hasHtml, true);
    assert.ok(output.renderedLength > 0);

    await vscode.commands.executeCommand('spssStudio.showData');
    const page = await waitFor(() => api.getDataPageSummary(), 'the real Active Dataset preview page');
    assert.equal(page.rows, 3);
    assert.equal(page.variables, 3);
    assert.equal(page.totalCases, 3);
    await vscode.commands.executeCommand('spssStudio.showVariables');
    assert.equal(api.getVariableCount(), 3);
    await vscode.commands.executeCommand('spssStudio.stopEngine');
  });
});
