import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { BridgeManager, type BridgeProcess } from '../../src/spss/bridgeManager';
import type { BridgeRequest, BridgeResponse } from '../../src/spss/types';
import type { SpssInstallation } from '../../src/spss/platform/types';
import { configureTransaction } from '../../src/setup/configurationTransaction';
import { probeRuntime } from '../../src/setup/runtimeProbe';
import { buildSetupReport } from '../../src/setup/setupReport';
import { setupAdvice } from '../../src/setup/setupStrings';
import { acquireSetupLock } from '../../src/setup/setupLock';
import os from 'node:os';

const installation: SpssInstallation = { installRoot: '/SPSS', pythonLauncher: '/SPSS/launcher', launchMode: 'ibm-launcher', environment: {} };
const configuration = { installPath: '', pythonLauncherPath: '', startupTimeoutSeconds: 2, executionTimeoutSeconds: 2, dataPreviewPageSize: 100, autoStart: true, debugLogging: false };

class ProbeProcess extends EventEmitter implements BridgeProcess {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly stdin: Writable;
  public readonly requests: BridgeRequest[] = [];
  public killed = false;
  private input = '';

  public constructor(private readonly failure?: 'data' | 'shutdown' | 'hang') {
    super();
    this.stdin = new Writable({ write: (chunk: Buffer, _encoding, callback) => {
      this.input += chunk.toString();
      let index = this.input.indexOf('\n');
      while (index >= 0) {
        const request = JSON.parse(this.input.slice(0, index)) as BridgeRequest;
        this.input = this.input.slice(index + 1);
        this.requests.push(request);
        this.answer(request);
        index = this.input.indexOf('\n');
      }
      callback();
    } });
  }

  private answer(request: BridgeRequest): void {
    if (this.failure === 'hang' && request.op === 'ping') { return; }
    const response: BridgeResponse = { id: request.id, ok: true, errorLevel: 0, durationMs: 1, output: '', warnings: [], error: null, engineAlive: request.op !== 'shutdown' };
    const variables = ['ssx_id', 'ssx_age', 'ssx_mean'].map((name, index) => ({ index, name, label: name, type: 'Numeric', format: 'F8.0' }));
    if (request.op === 'run') {
      const directory = request.outputDirectory ?? '';
      response.htmlPath = path.join(directory, 'output.html');
      fs.writeFileSync(response.htmlPath, '<table><tr><td>ssx_age</td><td>30</td></tr></table>');
    }
    if (request.op === 'datasetInfo') {
      response.datasetInfo = { active: true, datasetName: 'SSXSetup', variableCount: 3, caseCount: 3, variables };
    }
    if (request.op === 'datasetPage') {
      response.datasetPage = { datasetName: 'SSXSetup', totalCases: 3, totalVariables: 3, offset: 0, limit: 3, variableStart: 0, variableLimit: 3, variables,
        rows: [[1, 20, 30], [2, 30, this.failure === 'data' ? 99 : 30], [3, 40, 30]] };
    }
    if (request.op === 'shutdown' && this.failure === 'shutdown') {
      response.ok = false;
      response.error = 'shutdown failed';
    }
    this.stdout.write(JSON.stringify(response) + '\n');
  }

  public kill(): boolean { this.killed = true; return true; }
}

function probeWith(child: ProbeProcess, signal = new AbortController().signal) {
  return probeRuntime(installation, '/bridge.py', configuration, signal, () => undefined,
    (options) => new BridgeManager({ ...options, platform: 'darwin', spawner: () => child }));
}

describe('one-click runtime setup', () => {
  it('prevents concurrent setup from two windows using the same local storage', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ssx-lock-test-'));
    try {
      const release = await acquireSetupLock(directory);
      await assert.rejects(acquireSetupLock(directory), /SETUP_LOCK_UNAVAILABLE/u);
      await release();
      const next = await acquireSetupLock(directory);
      await next();
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  it('accepts only correct calculation, data, HTML, and graceful shutdown together', async () => {
    const child = new ProbeProcess();
    const result = await probeWith(child);
    assert.equal(result.ok, true);
    assert.deepEqual(result.passed, ['startup', 'analysis', 'data', 'output', 'shutdown']);
    const run = child.requests.find((request) => request.op === 'run');
    assert.ok(run?.outputDirectory);
    assert.equal(fs.existsSync(run.outputDirectory), false);
    assert.match(run.syntax ?? '', /AGGREGATE/u);
  });

  it('never reports success for an incorrect mean or failed graceful shutdown', async () => {
    const wrong = await probeWith(new ProbeProcess('data'));
    assert.equal(wrong.ok, false);
    assert.equal(wrong.error, 'SETUP_DATA_FAILED');
    const shutdown = await probeWith(new ProbeProcess('shutdown'));
    assert.equal(shutdown.ok, false);
    assert.equal(shutdown.stage, 'shutdown');
  });

  it('cancels a hanging startup and terminates its isolated child', async () => {
    const child = new ProbeProcess('hang');
    const abort = new AbortController();
    const pending = probeWith(child, abort.signal);
    setTimeout(() => abort.abort(), 20);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.error, 'SETUP_CANCELLED');
    assert.equal(child.killed, true);
  });

  it('rolls back all touched configuration keys when final verification fails', async () => {
    const values = new Map<string, unknown>([['installPath', 'old'], ['otherExtension', 'untouched']]);
    await assert.rejects(configureTransaction([
      { key: 'installPath', target: 'global', before: 'old', after: 'new' },
      { key: 'autoStart', target: 'global', before: undefined, after: true },
    ], (edit, value) => {
      if (value === undefined) { values.delete(edit.key); } else { values.set(edit.key, value); }
      return Promise.resolve();
    }, () => Promise.reject(new Error('verification failed'))), /verification failed/u);
    assert.equal(values.get('installPath'), 'old');
    assert.equal(values.has('autoStart'), false);
    assert.equal(values.get('otherExtension'), 'untouched');
  });

  it('reports a rollback failure instead of claiming prior settings were restored', async () => {
    await assert.rejects(configureTransaction([
      { key: 'installPath', target: 'global', before: 'old', after: 'new' },
    ], (_edit, value) => value === 'old' ? Promise.reject(new Error('permission denied')) : Promise.resolve(),
    () => Promise.reject(new Error('verification failed'))), /SETUP_ROLLBACK_FAILED/u);
  });

  it('preserves user edits made during verification instead of overwriting them on rollback', async () => {
    let value: unknown = 'old';
    await assert.rejects(configureTransaction([
      { key: 'installPath', target: 'global', before: 'old', after: 'new' },
    ], (_edit, next) => { value = next; return Promise.resolve(); }, () => {
      value = 'user-edited';
      return Promise.reject(new Error('cancelled'));
    }, () => value), /SETUP_ROLLBACK_FAILED/u);
    assert.equal(value, 'user-edited');
    assert.match(setupAdvice('SETUP_ROLLBACK_FAILED SETUP_CANCELLED', 'zh-cn'), /恢复旧配置/u);
  });

  it('keeps concise bilingual reports and redacts credential-shaped diagnostics', () => {
    const report = buildSetupReport({ version: '1.4.0', createdAt: '2026-10-28', platform: 'win32', vscodeVersion: '1.95', success: false,
      probes: [], warnings: [], advice: 'Retry', error: 'token=private-value Bearer secret-value sk-private12345678' }, 'zh-cn');
    assert.match(report, /SPSS Studio 配置报告/u);
    assert.doesNotMatch(report, /private-value|secret-value|sk-private/u);
    assert.match(setupAdvice('Unable to import IBM SPSS Python module', 'en'), /Repair/u);
    assert.match(setupAdvice('SETUP_ENGINE_BUSY', 'zh-cn'), /手动/u);
  });
});
