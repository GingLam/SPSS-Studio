import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import type { StudioSession } from '../../src/studioSession';
import type { EngineService, SpssRuntimeConfiguration } from '../../src/spss/engineService';
import { VariableCache } from '../../src/spss/variableCache';
import type { ActiveDatasetInfo, DatasetPage } from '../../src/spss/types';
import type { SpssStudioPanel } from '../../src/views/spssStudioPanel';
import type { OutputStore } from '../../src/views/outputStore';
import type { OutputChannel } from 'vscode';

describe('Clear recovery', () => {
  it('allows Clear for an idle engine even when only inactive named datasets remain', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../media/studio.js'), 'utf8');
    const action = source.match(/ {2}function updateClearAction\(\) \{[\s\S]*?\n {2}\}/u)?.[0];
    assert.ok(action);
    const button = { disabled: true };
    const state = { engineState: 'ready', dataBusy: false, dataset: undefined };
    vm.runInNewContext(`${action}\nupdateClearAction();`, { state, byId: () => button });
    assert.equal(button.disabled, false);
    state.dataBusy = true;
    vm.runInNewContext(`${action}\nupdateClearAction();`, { state, byId: () => button });
    assert.equal(button.disabled, true);
  });

  it('resets pending page state after a rejected Clear without claiming data were cleared', async () => {
    // Load the real compiled controller; only the external VS Code surface is substituted.
    const filename = path.resolve(__dirname, '../../src/studioSession.js');
    const localRequire = createRequire(filename);
    const loaded: { StudioSession?: typeof StudioSession } = {};
    const evaluate = vm.runInThisContext(`(function(exports, require) {${fs.readFileSync(filename, 'utf8')}\n})`) as (exports: object, require: (name: string) => unknown) => void;
    evaluate(loaded, (name) => name === 'vscode'
      ? { env: { language: 'en' }, workspace: { isTrusted: true }, window: { showErrorMessage: () => undefined } }
      : localRequire(name));
    assert.ok(loaded.StudioSession);
    const metadata: ActiveDatasetInfo = { active: true, datasetName: 'KeepMe', caseCount: 1, variableCount: 1,
      variables: [{ index: 0, name: 'id', label: '', type: 'Numeric', format: 'F1.0' }] };
    const page: DatasetPage = { datasetName: 'KeepMe', totalCases: 1, totalVariables: 1, offset: 0, limit: 100, variableStart: 0, variableLimit: 50, variables: metadata.variables, rows: [[1]] };
    let resolvePage!: (value: DatasetPage) => void;
    const pending = new Promise<DatasetPage>((resolve) => { resolvePage = resolve; });
    const engine = {
      datasetPage: () => pending, datasetInfo: () => Promise.resolve(metadata),
      clearData: () => Promise.reject(new Error('Clear rejected while page is running')),
      status: () => ({ engineAlive: true }),
    } as unknown as EngineService;
    const events: string[] = [];
    const panel = {
      dataVisible: true, setDataActionsBusy: () => undefined,
      setDatasetPage: () => events.push('page'), clearDatasetPage: () => undefined,
      setDatasetMetadata: (info: ActiveDatasetInfo | undefined) => events.push(info?.active ? 'metadata-reset' : 'empty'),
      dataCleared: () => events.push('cleared'),
    } as unknown as SpssStudioPanel;
    const cache = new VariableCache();
    cache.replace(metadata);
    const store = { metadata: [{ id: 'existing-run' }] } as unknown as OutputStore;
    const session = new loaded.StudioSession(engine, cache, store, panel,
      { appendLine: () => undefined } as unknown as OutputChannel,
      () => ({ dataPreviewPageSize: 100 } as SpssRuntimeConfiguration));
    const paging = session.requestDatasetPage({ offset: 0, limit: 100, variableStart: 0, variableLimit: 50, requestId: 1, generation: 1 });
    await assert.rejects(session.clearData(), /Clear rejected/u);
    resolvePage(page);
    await paging;
    assert.ok(events.includes('metadata-reset'), 'metadata must reset the front-end pending generation');
    assert.ok(!events.includes('cleared'));
    assert.equal(cache.variables[0]?.name, 'id');
    assert.equal(session.historyCount, 1);
  });
});
