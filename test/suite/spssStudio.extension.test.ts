import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import type { BridgeRequest } from '../../src/spss/types';
import type { SpssStudioExtensionApi } from '../../src/extension';
import { windowsDiskDiscovery } from '../../src/spss/windowsDiskDiscovery';

async function waitForRequests(capturePath: string, runCount: number): Promise<BridgeRequest[]> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(capturePath)) {
      const requests = fs
        .readFileSync(capturePath, 'utf8')
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as BridgeRequest);
      if (requests.filter((request) => request.op === 'run').length >= runCount) {
        return requests;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${String(runCount)} fake SPSS run request(s).`);
}

async function waitForOperation(capturePath: string, operation: BridgeRequest['op']): Promise<BridgeRequest[]> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(capturePath)) {
      const requests = fs.readFileSync(capturePath, 'utf8').split(/\r?\n/u).filter(Boolean)
        .map((line) => JSON.parse(line) as BridgeRequest);
      if (requests.some((request) => request.op === operation)) {
        return requests;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for fake SPSS operation ${operation}.`);
}

async function completionLabels(content: string): Promise<string[]> {
  const document = await vscode.workspace.openTextDocument({ language: 'spss', content });
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    document.uri,
    document.positionAt(content.length),
  );
  return completions.items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

async function waitForValue<T>(read: () => T, expected: T, description: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (read() === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(read())}.`);
}

describe('SPSS Studio Extension Host', () => {
  it('launches the packaged discovery worker in the VS Code runtime', async () => {
    const extension = vscode.extensions.getExtension('jinglin.spss-studio');
    assert.ok(extension);
    const result = await windowsDiskDiscovery(undefined, {
      roots: [], workerPath: path.join(extension.extensionPath, 'out', 'src', 'spss', 'windowsScanWorker.js'),
    });
    assert.equal(result.truncated, false, 'Bundled worker must launch without external Node/Python installations');
    assert.equal(result.installations.length, 0);
  });

  it('registers the language, commands, keybinding, execution paths, output, and status bar', async () => {
    const installRoot = process.env.SPSS_STUDIO_TEST_INSTALL_ROOT;
    const launcherPath = process.env.SPSS_STUDIO_TEST_LAUNCHER;
    const capturePath = process.env.SPSS_STUDIO_FAKE_CAPTURE;
    const workspacePath = process.env.SPSS_STUDIO_TEST_WORKSPACE;
    assert.ok(installRoot && launcherPath && capturePath && workspacePath);

    const configuration = vscode.workspace.getConfiguration('spssStudio');
    await configuration.update('installPath', installRoot, vscode.ConfigurationTarget.Workspace);
    await configuration.update('pythonLauncherPath', launcherPath, vscode.ConfigurationTarget.Workspace);
    await configuration.update('startupTimeoutSeconds', 10, vscode.ConfigurationTarget.Workspace);
    await configuration.update('executionTimeoutSeconds', 10, vscode.ConfigurationTarget.Workspace);
    await configuration.update('autoStart', true, vscode.ConfigurationTarget.Workspace);

    const languages = await vscode.languages.getLanguages();
    assert.ok(languages.includes('spss'));

    const extension = vscode.extensions.getExtension<SpssStudioExtensionApi>('jinglin.spss-studio');
    assert.ok(extension);
    const api = await extension.activate();
    assert.equal(api.outputChannelName, 'SPSS');
    assert.match(api.getStatusBarText(), /SPSS: Stopped/u);

    const expectedCommands = [
      'spssStudio.undo',
      'spssStudio.runSelection',
      'spssStudio.runFile',
      'spssStudio.startEngine',
      'spssStudio.stopEngine',
      'spssStudio.restartEngine',
      'spssStudio.showStatus',
      'spssStudio.showOutput',
      'spssStudio.showData',
      'spssStudio.showVariables',
      'spssStudio.showAi',
      'spssStudio.configureAi',
      'spssStudio.refreshDataPreview',
      'spssStudio.clearOutput',
    ];
    const commands = await vscode.commands.getCommands(true);
    for (const command of expectedCommands) {
      assert.ok(commands.includes(command), `Command was not registered: ${command}`);
    }
    const packageJson = extension.packageJSON as {
      contributes: { keybindings: Array<{ command: string; key: string; mac: string; when: string }> };
    };
    assert.deepEqual(packageJson.contributes.keybindings[0], {
      command: 'spssStudio.runSelection',
      key: 'ctrl+enter',
      mac: 'cmd+enter',
      when: 'editorTextFocus && editorLangId == spss',
    });
    assert.ok((await completionLabels('reg')).includes('REGRESSION'));
    assert.ok((await completionLabels('get d')).includes('GET DATA'));
    assert.ok(!(await completionLabels('TITLE "reg')).includes('REGRESSION'));

    // First-install Quick Start is a Webview. Close startup editors in this
    // isolated test profile before exercising a native editor Undo command.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('workbench.action.editorLayoutSingle');
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(workspacePath, 'commands.sps')),
    );
    assert.equal(document.languageId, 'spss');
    const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    await vscode.commands.executeCommand('workbench.action.focusWindow');
    await waitForValue(() => vscode.window.state.focused, true, 'the isolated test window to gain focus');
    const originalText = document.getText();
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    // Allow native editor focus to settle after the command RPC.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await vscode.commands.executeCommand('default:type', { text: 'x' });
    await waitForValue(() => document.getText().startsWith('x'), true, 'native editor typing');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), document.uri.toString());
    await new Promise((resolve) => setTimeout(resolve, 250));
    await vscode.commands.executeCommand('spssStudio.undo');
    await waitForValue(() => document.getText(), originalText, 'the native undo edit');

    editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 19));
    await vscode.commands.executeCommand('spssStudio.runSelection');
    let requests = await waitForRequests(capturePath, 1);
    assert.equal(requests.filter((request) => request.op === 'run')[0]?.syntax, 'COMPUTE x = 1.25.');
    await waitForOperation(capturePath, 'datasetInfo');
    assert.equal(api.getVariableCount(), 2);
    assert.ok((await completionLabels('DESCRIPTIVES VARIABLES=hou')).includes('HouseholdIncome'));

    const currentPosition = new vscode.Position(2, 10);
    editor.selection = new vscode.Selection(currentPosition, currentPosition);
    await vscode.commands.executeCommand('spssStudio.runSelection');
    requests = await waitForRequests(capturePath, 2);
    assert.equal(
      requests.filter((request) => request.op === 'run')[1]?.syntax,
      'FREQUENCIES VARIABLES=x.',
    );

    await vscode.commands.executeCommand('spssStudio.runFile');
    requests = await waitForRequests(capturePath, 3);
    assert.equal(
      requests.filter((request) => request.op === 'run')[2]?.syntax,
      document.getText(),
    );
    assert.equal(api.getEngineState(), 'ready');
    assert.match(api.getStatusBarText(), /SPSS: Ready/u);
    assert.equal(api.getOutputHistoryCount(), 3);

    const failingDocument = await vscode.workspace.openTextDocument({
      language: 'spss',
      content: 'COMPUTE partiallyChanged=1.\nFORCE_ERROR.',
    });
    await vscode.window.showTextDocument(failingDocument);
    await vscode.commands.executeCommand('spssStudio.runFile');
    await waitForRequests(capturePath, 4);
    await waitForValue(() => api.getVariableCount(), 3, 'metadata refresh after an SPSS error');
    assert.equal(api.getSelectedOutput()?.status, 'ERROR');
    assert.ok((await completionLabels('DESCRIPTIVES VARIABLES=part')).includes('partiallyChanged'));

    await vscode.commands.executeCommand('spssStudio.showData');
    requests = await waitForOperation(capturePath, 'datasetPage');
    const pageRequest = requests.find((request) => request.op === 'datasetPage');
    assert.ok(pageRequest);
    assert.equal(pageRequest.limit, 100);
    assert.equal(pageRequest.offset, 0);

    await vscode.commands.executeCommand('spssStudio.showVariables');
    assert.equal(api.getVariableCount(), 3);

    await vscode.commands.executeCommand('spssStudio.clearOutput');
    assert.equal(api.getOutputHistoryCount(), 0);
    assert.equal(api.getVariableCount(), 3);

    await vscode.commands.executeCommand('spssStudio.stopEngine');
    assert.equal(api.getEngineState(), 'stopped');
    assert.equal(api.getVariableCount(), 0);
    await vscode.commands.executeCommand('spssStudio.restartEngine');
    await waitForValue(() => api.getEngineState(), 'ready', 'engine restart');
    await vscode.commands.executeCommand('spssStudio.stopEngine');
  });
  it('creates a fresh SPSS editor beside Studio without starting or executing the engine', async () => {
    const extension = vscode.extensions.getExtension<SpssStudioExtensionApi>('jinglin.spss-studio');
    assert.ok(extension);
    const api = await extension.activate();
    const history = api.getOutputHistoryCount();
    const state = api.getEngineState();
    await vscode.commands.executeCommand('spssStudio.newFile');
    const firstEditor = vscode.window.activeTextEditor;
    assert.ok(firstEditor);
    const first = firstEditor.document;
    assert.equal(first.isUntitled, true);
    assert.equal(first.languageId, 'spss');
    assert.equal(first.getText(), '');
    assert.equal(firstEditor.viewColumn, vscode.ViewColumn.One);
    await waitForValue(() => vscode.window.tabGroups.all.some((group) => group.viewColumn === vscode.ViewColumn.Two && group.tabs.some((tab) => tab.input instanceof vscode.TabInputWebview && tab.label === 'SPSS Studio')), true, 'Studio in the second editor group');
    await vscode.commands.executeCommand('spssStudio.newFile');
    const second = vscode.window.activeTextEditor;
    assert.ok(second);
    assert.notEqual(second.document.uri.toString(), first.uri.toString());
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
    // Allow native editor focus to settle after the command RPC.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await vscode.commands.executeCommand('default:type', { text: 'x' });
    await waitForValue(() => second.document.getText(), 'x', 'typing in the new SPSS file');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await vscode.commands.executeCommand('spssStudio.undo');
    await waitForValue(() => second.document.getText(), '', 'undo in the new SPSS file');
    assert.equal(api.getOutputHistoryCount(), history);
    assert.equal(api.getEngineState(), state);
  });

});
