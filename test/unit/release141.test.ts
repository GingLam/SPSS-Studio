import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineService } from '../../src/spss/engineService';
import { OutputStore, type ExecutionRecord } from '../../src/views/outputStore';
import type { BridgeResponse } from '../../src/spss/types';
import { isWebviewMessage } from '../../src/views/webviewProtocol';

describe('1.4.1 data lifecycle', () => {
  it('does not start an engine just to clear an empty session', async () => {
    let discoveries = 0;
    const engine = new EngineService('/extension', { onStateChange: () => undefined, onDiagnostic: () => undefined }, {
      locate: () => { discoveries += 1; return Promise.resolve(undefined); },
    }) as EngineService & { clearData(): Promise<void> };
    await engine.clearData();
    assert.equal(discoveries, 0);
    assert.equal(engine.status().state, 'stopped');
    const release = engine.reserveForSetup();
    try { await assert.rejects(async () => engine.clearData(), /setup/iu); }
    finally { release(); }
  });

  it('keeps the dataset counts with their original run and preserves native warnings', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssx-summary-'));
    const store = new OutputStore(root) as OutputStore & {
      complete(id: string, response: BridgeResponse, summary: { caseCount: number; variableCount: number }): ExecutionRecord;
    };
    try {
      const one = store.begin('Read data');
      const htmlPath = path.join(one.target.outputDirectory, 'output.html');
      fs.writeFileSync(htmlPath, '<p>Warning # 67. Command name: GET FILE<br>The document is already in use.</p>');
      const summary = { caseCount: 2246, variableCount: 12 };
      store.complete(one.record.id, { id: 'one', ok: true, errorLevel: 2, output: '', warnings: [], error: 'Warning.', durationMs: 1, status: 'WARNING', engineAlive: true, htmlPath }, summary);
      summary.caseCount = 1;
      const record = store.metadata[0] as typeof store.metadata[number] & { datasetSummary?: typeof summary };
      assert.deepEqual(record.datasetSummary, { caseCount: 2246, variableCount: 12 });
      assert.equal(record.status, 'WARNING');
      assert.equal(record.errorMessage, 'Warning.');
      assert.equal(Reflect.get(record, 'fileInUseWarning'), true);
      const two = store.begin('Other data');
      store.complete(two.record.id, { id: 'two', ok: true, errorLevel: 0, output: '', warnings: [], error: null, durationMs: 1 }, { caseCount: 60, variableCount: 6 });
      assert.equal((store.metadata[1] as typeof record).datasetSummary?.caseCount, 2246);
    } finally { store.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('accepts clearData separately from clearing output history', () => {
    assert.equal(isWebviewMessage({ type: 'clearData' }), true);
    assert.equal(isWebviewMessage({ type: 'clearOutput' }), true);
  });
});
