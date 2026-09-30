import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { BridgeManager, type BridgeProcess, type ProcessSpawner } from '../../src/spss/bridgeManager';
import type { SpssInstallation } from '../../src/spss/platform/types';
import type { BridgeRequest, BridgeResponse } from '../../src/spss/types';

const outputTarget = { runId: 'run-1', outputDirectory: '/tmp/spss-studio/session/run-1' };

const installation: SpssInstallation = {
  version: '32',
  installRoot: '/Applications/IBM SPSS Statistics 32',
  pythonLauncher: '/Applications/IBM SPSS Statistics 32/SPSS Statistics.app/Contents/bin/statisticspython3',
  launchMode: 'ibm-launcher',
  environment: { SPSSHOME: '/Applications/IBM SPSS Statistics 32/SPSS Statistics.app/Contents' },
};

function responseFor(request: BridgeRequest): BridgeResponse {
  return {
    id: request.id,
    ok: true,
    errorLevel: 0,
    output: request.op === 'run' ? 'output' : '',
    warnings: [],
    error: null,
    durationMs: 1,
    engineAlive: request.op !== 'shutdown',
    ...(request.op === 'run' ? { status: 'SUCCESS' as const, htmlPath: `${request.outputDirectory ?? ''}/output.html` } : {}),
    ...(request.op === 'datasetInfo' ? {
      datasetInfo: {
        active: true,
        datasetName: 'DataSet1',
        caseCount: 2,
        variableCount: 1,
        variables: [{ index: 0, name: 'age', label: 'Age', type: 'Numeric', format: 'F8.0' }],
      },
    } : {}),
    ...(request.op === 'datasetPage' ? {
      datasetPage: {
        datasetName: 'DataSet1',
        totalCases: 2,
        totalVariables: 1,
        offset: request.offset ?? 0,
        limit: request.limit ?? 100,
        variableStart: request.variableStart ?? 0,
        variableLimit: request.variableLimit ?? 50,
        variables: [{ index: 0, name: 'age', label: 'Age', type: 'Numeric', format: 'F8.0' }],
        rows: [[20], [30]],
      },
    } : {}),
  };
}

class FakeBridgeProcess extends EventEmitter implements BridgeProcess {
  public readonly pid = 4242;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly requests: BridgeRequest[] = [];
  public killed = false;
  public readonly stdin: Writable;
  private inputBuffer = '';

  public constructor(private readonly handler: (request: BridgeRequest, process: FakeBridgeProcess) => void) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
        this.inputBuffer += chunk.toString();
        let newline = this.inputBuffer.indexOf('\n');
        while (newline >= 0) {
          const line = this.inputBuffer.slice(0, newline);
          this.inputBuffer = this.inputBuffer.slice(newline + 1);
          const request = JSON.parse(line) as BridgeRequest;
          this.requests.push(request);
          this.handler(request, this);
          newline = this.inputBuffer.indexOf('\n');
        }
        callback();
      },
    });
  }

  public send(response: BridgeResponse, split = false): void {
    const line = `${JSON.stringify(response)}\n`;
    if (split) {
      const midpoint = Math.floor(line.length / 2);
      this.stdout.write(line.slice(0, midpoint));
      this.stdout.write(line.slice(midpoint));
    } else {
      this.stdout.write(line);
    }
  }

  public kill(): boolean {
    this.killed = true;
    return true;
  }
}

function managerWith(
  handler: (request: BridgeRequest, process: FakeBridgeProcess) => void,
  overrides: Partial<ConstructorParameters<typeof BridgeManager>[0]> = {},
): { manager: BridgeManager; process: FakeBridgeProcess; diagnostics: string[] } {
  const process = new FakeBridgeProcess(handler);
  const diagnostics: string[] = [];
  const spawner: ProcessSpawner = () => process;
  const manager = new BridgeManager({
    startupTimeoutMs: 100,
    executionTimeoutMs: 100,
    shutdownTimeoutMs: 100,
    spawner,
    platform: 'darwin',
    onDiagnostic: (message) => diagnostics.push(message),
    ...overrides,
  });
  return { manager, process, diagnostics };
}

describe('BridgeManager', () => {
  it('frames partial JSONL responses and exposes process state', async () => {
    const { manager, process } = managerWith((request, child) => child.send(responseFor(request), true));
    await manager.start(installation, '/extension/resources/bridge/spss_bridge.py');
    const response = await manager.run('DESCRIPTIVES VARIABLES=x.', outputTarget);
    assert.equal(response.output, 'output');
    assert.equal(manager.status().state, 'ready');
    assert.equal(manager.status().processId, 4242);
    assert.equal(process.requests.length, 2);
  });

  it('serializes multiple run requests', async () => {
    let firstRun: BridgeRequest | undefined;
    const { manager, process } = managerWith((request, child) => {
      if (request.op === 'ping') {
        child.send(responseFor(request));
      } else if (request.op === 'run' && !firstRun) {
        firstRun = request;
      } else {
        child.send(responseFor(request));
      }
    });
    await manager.start(installation, '/bridge.py');
    const firstPromise = manager.run('FIRST.', outputTarget);
    const secondPromise = manager.run('SECOND.', { ...outputTarget, runId: 'run-2' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(process.requests.filter((request) => request.op === 'run').length, 1);
    assert.ok(firstRun);
    process.send(responseFor(firstRun));
    await firstPromise;
    await secondPromise;
    assert.equal(process.requests.filter((request) => request.op === 'run').length, 2);
  });

  it('rejects pending requests and marks the engine dead after a crash', async () => {
    const { manager, process } = managerWith((request, child) => {
      if (request.op === 'ping') {
        child.send(responseFor(request));
      }
    });
    await manager.start(installation, '/bridge.py');
    const running = manager.run('LONG RUN.', outputTarget);
    await new Promise((resolve) => setImmediate(resolve));
    process.emit('close', 1, null);
    await assert.rejects(running, /exited/u);
    assert.equal(manager.status().state, 'error');
    assert.equal(manager.status().engineAlive, false);
  });

  it('terminates a timed-out bridge and can be started again', async () => {
    const { manager, process } = managerWith((request, child) => {
      if (request.op === 'ping') {
        child.send(responseFor(request));
      }
    }, { executionTimeoutMs: 20 });
    await manager.start(installation, '/bridge.py');
    await assert.rejects(manager.run('HANG.', outputTarget), /timed out/u);
    assert.equal(process.killed, true);
    assert.equal(manager.status().state, 'error');
  });

  it('handles malformed JSON and orphan response ids', async () => {
    const { manager, process, diagnostics } = managerWith((request, child) => child.send(responseFor(request)));
    await manager.start(installation, '/bridge.py');
    process.send({ ...responseFor({ id: 'orphan', op: 'status' }), id: 'orphan' });
    assert.match(diagnostics.join('\n'), /orphan/u);
    process.stdout.write('{bad json}\n');
    assert.equal(manager.status().state, 'error');
    assert.equal(process.killed, true);
  });

  it('sends a graceful shutdown request', async () => {
    const { manager, process } = managerWith((request, child) => child.send(responseFor(request)));
    await manager.start(installation, '/bridge.py');
    await manager.stop();
    assert.equal(process.requests.at(-1)?.op, 'shutdown');
    assert.equal(manager.status().state, 'stopped');
  });

  it('launches a Windows batch wrapper with trusted paths and keeps syntax on stdin', async () => {
    const child = new FakeBridgeProcess((request, process) => process.send(responseFor(request)));
    let launchedExecutable = '';
    let launchedArguments: string[] = [];
    const manager = new BridgeManager({
      startupTimeoutMs: 100,
      executionTimeoutMs: 100,
      platform: 'win32',
      environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      spawner: (executable, args) => {
        launchedExecutable = executable;
        launchedArguments = args;
        return child;
      },
    });
    const windowsInstallation: SpssInstallation = {
      version: '32',
      installRoot: 'C:\\Program Files\\IBM\\SPSS Statistics\\32',
      pythonLauncher: 'C:\\Program Files\\IBM\\SPSS Statistics\\32\\statisticspython3.bat',
      launchMode: 'ibm-launcher',
      environment: {},
    };
    await manager.start(windowsInstallation, 'C:\\Extension Path\\resources\\bridge\\spss_bridge.py');
    await manager.run('HOST COMMAND=["not a shell argument"].', outputTarget);
    assert.equal(launchedExecutable, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(launchedArguments.slice(0, 3), ['/d', '/s', '/c']);
    assert.match(launchedArguments[3] ?? '', /statisticspython3\.bat/u);
    assert.ok(!launchedArguments.join(' ').includes('HOST COMMAND'));
    await manager.stop();
  });

  it('serializes dataset metadata and page reads through the same queue', async () => {
    let heldRun: BridgeRequest | undefined;
    const { manager, process } = managerWith((request, child) => {
      if (request.op === 'ping') {
        child.send(responseFor(request));
      } else if (request.op === 'run') {
        heldRun = request;
      } else {
        child.send(responseFor(request));
      }
    });
    await manager.start(installation, '/bridge.py');
    const running = manager.run('LONG PROCEDURE.', outputTarget);
    const metadata = manager.datasetInfo();
    const page = manager.datasetPage({ offset: 0, limit: 100, variableStart: 0, variableLimit: 50 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(process.requests.filter((request) => request.op === 'datasetInfo').length, 0);
    assert.ok(heldRun);
    process.send(responseFor(heldRun));
    await running;
    assert.equal((await metadata).variableCount, 1);
    assert.deepEqual((await page).rows, [[20], [30]]);
    assert.deepEqual(
      process.requests.filter((request) => ['run', 'datasetInfo', 'datasetPage'].includes(request.op)).map((request) => request.op),
      ['run', 'datasetInfo', 'datasetPage'],
    );
  });
});
