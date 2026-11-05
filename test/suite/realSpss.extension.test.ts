import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import type { SpssStudioExtensionApi } from '../../src/extension';
import { htmlText, parseHtmlDocument } from '../../src/ai/htmlDocument';

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
  it('executes the reported CRLF recode through the editor without rewriting its buffer', async () => {
    const installRoot = process.env.SPSS_STUDIO_REAL_INSTALL_ROOT;
    const launcher = process.env.SPSS_STUDIO_REAL_LAUNCHER;
    assert.ok(installRoot && launcher);
    const configuration = vscode.workspace.getConfiguration('spssStudio');
    await configuration.update('installPath', installRoot, vscode.ConfigurationTarget.Workspace);
    await configuration.update('pythonLauncherPath', launcher, vscode.ConfigurationTarget.Workspace);
    await configuration.update('autoStart', true, vscode.ConfigurationTarget.Workspace);
    const extension = vscode.extensions.getExtension<SpssStudioExtensionApi>('jinglin.spss-studio');
    assert.ok(extension);
    const api = await extension.activate();
    const source = [
      'NEW FILE.', 'DATASET CLOSE ALL.', 'DATA LIST FREE /I2_1.', 'BEGIN DATA',
      '1', '2', '3', '4', '7', '8', '9', '10', '11', '99', '99997', '99998', '99999', 'END DATA.',
      'RECODE I2_1 (1=0) (2=6) ', '            (3=9) (4 THRU 7=12)',
      '            (8=15) (9=16)', '            (10=19) (11=22)',
      '            (99,99997,99998,99999=SYSMIS)            ', '            INTO edu_year.',
      'VARIABLE LEVEL edu_year (SCALE).', 'EXECUTE.', 'DESCRIPTIVES edu_year.',
    ].join('\r\n');
    const document = await vscode.workspace.openTextDocument({ language: 'spss', content: source });
    await vscode.window.showTextDocument(document);
    try {
      await vscode.commands.executeCommand('spssStudio.runFile');
      assert.equal(api.getSelectedOutput()?.status, 'SUCCESS');
      assert.equal(api.getVariableCount(), 2);
      const profile = (await api.getVariableProfiles(['edu_year'])).profiles[0];
      assert.ok(profile);
      assert.equal(profile.summary.kind, 'continuous');
      assert.equal(profile.summary.validN, 9);
      assert.equal(profile.summary.missingN, 4);
      assert.ok(Math.abs((profile.summary.mean ?? 0) - 111 / 9) < 1e-9);
      assert.equal(document.getText(), source, 'The editor keeps its original Windows CRLF text.');
      const baseline: unknown = JSON.parse(process.env.SPSS_STUDIO_REAL_BASELINE_OUTPUT_SESSIONS ?? '[]');
      assert.ok(Array.isArray(baseline));
      const outputRoot = path.join(os.tmpdir(), 'spss-studio');
      const sessions = fs.readdirSync(outputRoot).filter((name) => name.startsWith('session-') && !baseline.includes(name));
      assert.equal(sessions.length, 1);
      const sessionRoot = path.join(outputRoot, sessions[0] ?? '');
      const runDirectory = fs.readdirSync(sessionRoot).find((name) => name.startsWith('run-1-'));
      assert.ok(runDirectory);
      const nativeOutput = htmlText(parseHtmlDocument(fs.readFileSync(path.join(sessionRoot, runDirectory, 'output.html'), 'utf8')));
      assert.equal(vscode.env.language, process.env.SPSS_STUDIO_TEST_UI_LANGUAGE ?? 'en');
      if (/^zh(?:[-_]|$)/iu.test(vscode.env.language)) {
        assert.match(nativeOutput, /描述统计/u);
        assert.match(nativeOutput, /平均值|均值|平均数/u);
      } else { assert.match(nativeOutput, /Descriptive Statistics/u); }
      const currentSource = [
        '* A researcher\'s comment.', '',
        'COMPUTE age_copy=', '', ' I2_1.', '',
        'COMMENT Don\'t interpret quotes as string delimiters here.', '',
        'RECODE I2_1 (1=0)', '', ' (2 THRU HIGHEST=1)', '', ' INTO ageband.', '',
        'VARIABLE LEVEL age_copy (SCALE).',
        'DO IF I2_1>0.', 'COMPUTE checked=1. /* valid line-end comment without a closing marker',
        'COMPUTE\tchecked=2.', 'END IF.', '', 'EXECUTE.',
      ].join('\r\n');
      const currentDocument = await vscode.workspace.openTextDocument({ language: 'spss', content: currentSource });
      for (const needle of [' I2_1.', ' INTO ageband.', 'COMPUTE checked=1.', 'EXECUTE.']) {
        const editor = await vscode.window.showTextDocument(currentDocument);
        const position = currentDocument.positionAt(currentSource.indexOf(needle));
        editor.selection = new vscode.Selection(position, position);
        const before = api.getOutputHistoryCount();
        await vscode.commands.executeCommand('spssStudio.runSelection');
        assert.equal(api.getOutputHistoryCount(), before + 1, `Current Run must execute ${needle}`);
        assert.ok(['SUCCESS', 'SUCCESS_NO_OUTPUT'].includes(api.getSelectedOutput()?.status ?? ''));
      }
      assert.equal(api.getVariableCount(), 5);
      const checked = (await api.getVariableProfiles(['checked'])).profiles[0];
      assert.ok(checked);
      assert.equal(checked.summary.validN, 13);
      assert.equal(checked.summary.missingN, 0);
      assert.equal(checked.summary.kind, 'categorical');
      assert.equal(checked.summary.topValues[0]?.value, 2);
      assert.equal(currentDocument.getText(), currentSource);
    } finally { await vscode.commands.executeCommand('spssStudio.stopEngine'); }
  });

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

    const extension = vscode.extensions.getExtension<SpssStudioExtensionApi>('jinglin.spss-studio');
    assert.ok(extension);
    const api = await extension.activate();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace, 'real.sps')));
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('spssStudio.runFile');

    assert.equal(api.getEngineState(), 'ready');
    const initialHistory = api.getOutputHistoryCount();
    assert.ok(initialHistory >= 1);
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
    const profiles = await api.getVariableProfiles(['age', 'income']);
    assert.equal(profiles.datasetName, 'ExtensionHostData');
    assert.deepEqual(profiles.profiles.map((profile) => profile.name), ['age', 'income']);
    const ageProfile = profiles.profiles[0];
    assert.ok(ageProfile);
    assert.equal(ageProfile.summary.kind, 'continuous');
    assert.equal(ageProfile.summary.validN, 3);
    assert.equal(ageProfile.summary.missingN, 0);
    assert.equal(api.getOutputHistoryCount(), initialHistory);
    await api.configureRuntime();
    assert.ok(vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => (
      tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('spssStudio.setup')
    ))), 'Setup must reveal its progress panel even when invoked outside the setup command');
    assert.equal(api.getSetupSummary()?.success, false);
    assert.equal(api.getSetupSummary()?.error, 'SETUP_ENGINE_BUSY');
    assert.equal(api.getEngineState(), 'ready');
    assert.equal(api.getVariableCount(), 3);
    await vscode.commands.executeCommand('spssStudio.stopEngine');
    await api.configureRuntime();
    assert.equal(api.getSetupSummary()?.success, true, api.getSetupSummary()?.error);
    assert.deepEqual(api.getSetupSummary()?.stages, ['startup', 'analysis', 'data', 'output', 'shutdown']);
    assert.equal(api.getEngineState(), 'stopped');
    // Verify normal Run still uses the saved configuration after isolated setup.
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('spssStudio.runFile');
    assert.equal(api.getEngineState(), 'ready');
    assert.equal(api.getVariableCount(), 3);
    assert.equal(api.getOutputHistoryCount(), initialHistory + 1);
    await api.openExample();
    const example = vscode.window.activeTextEditor?.document;
    assert.ok(example);
    assert.equal(example.languageId, 'spss');
    assert.match(example.getText(), /GET FILE="/u);
    assert.equal(api.getOutputHistoryCount(), initialHistory + 1, 'Example must not auto-run');
    await vscode.commands.executeCommand('spssStudio.runFile');
    assert.equal(api.getVariableCount(), 6);
    assert.equal(api.getSelectedOutput()?.status, 'SUCCESS');
    const history = api.getOutputHistoryCount();
    await api.clearData();
    assert.equal(api.getVariableCount(), 0);
    assert.equal(api.getEngineState(), 'ready');
    assert.equal(api.getOutputHistoryCount(), history);
    await vscode.window.showTextDocument(example);
    await vscode.commands.executeCommand('spssStudio.runFile');
    assert.equal(api.getVariableCount(), 6);
    assert.equal(api.getSelectedOutput()?.status, 'SUCCESS');
    await vscode.commands.executeCommand('spssStudio.stopEngine');
  });
});
