import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { BridgeManager, type BridgeProcess } from '../../src/spss/bridgeManager';
import { EngineService, type SpssRuntimeConfiguration } from '../../src/spss/engineService';
import type { SpssInstallation } from '../../src/spss/platform/types';
import type { BridgeRequest, BridgeResponse } from '../../src/spss/types';

const configuration: SpssRuntimeConfiguration = {
  installPath: '',
  pythonLauncherPath: '',
  startupTimeoutSeconds: 1,
  executionTimeoutSeconds: 1,
  dataPreviewPageSize: 100,
  autoStart: true,
  debugLogging: false,
};

const installation: SpssInstallation = {
  version: '32',
  installRoot: 'C:\\Program Files\\IBM\\SPSS Statistics\\32',
  pythonLauncher: 'C:\\Program Files\\IBM\\SPSS Statistics\\32\\statisticspython3.bat',
  launchMode: 'ibm-launcher',
  environment: { SPSS_HOME: 'C:\\Program Files\\IBM\\SPSS Statistics\\32' },
};

function responseFor(request: BridgeRequest): BridgeResponse {
  return {
    id: request.id,
    ok: true,
    errorLevel: 0,
    output: '',
    warnings: [],
    error: null,
    durationMs: 1,
    engineAlive: request.op !== 'shutdown',
    ...(request.op === 'run' ? { status: 'SUCCESS' as const } : {}),
    ...(request.op === 'datasetInfo' ? {
      datasetInfo: {
        active: true,
        datasetName: 'DataSet1',
        caseCount: 1,
        variableCount: 1,
        variables: [{ index: 0, name: 'id', label: 'ID', type: 'Numeric', format: 'F8.0' }],
      },
    } : {}),
  };
}

class ResponsiveBridgeProcess extends EventEmitter implements BridgeProcess {
  public readonly pid = 7200;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly stdin: Writable;
  private inputBuffer = '';

  public constructor(
    private readonly response: (request: BridgeRequest) => BridgeResponse = responseFor,
  ) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) => {
        this.inputBuffer += chunk.toString();
        let newline = this.inputBuffer.indexOf('\n');
        while (newline >= 0) {
          const request = JSON.parse(this.inputBuffer.slice(0, newline)) as BridgeRequest;
          this.inputBuffer = this.inputBuffer.slice(newline + 1);
          this.stdout.write(`${JSON.stringify(this.response(request))}\n`);
          newline = this.inputBuffer.indexOf('\n');
        }
        callback();
      },
    });
  }

  public kill(): boolean {
    return true;
  }
}

class SilentBridgeProcess extends EventEmitter implements BridgeProcess {
  public readonly pid = 7300;
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly stdin = new Writable({
    write: (_chunk, _encoding, callback) => callback(),
  });

  public kill(): boolean {
    return true;
  }
}

describe('EngineService startup lifecycle', () => {
  it('reserves setup exclusively and refuses to replace an active SPSS session', async () => {
    const service = new EngineService('/extension', { onStateChange: () => undefined, onDiagnostic: () => undefined }, {
      locate: () => Promise.resolve(installation),
      createManager: (options) => new BridgeManager({ ...options, platform: 'darwin', spawner: () => new ResponsiveBridgeProcess() }),
    });
    const release = service.reserveForSetup();
    assert.throws(() => service.start(configuration), /setup is in progress/u);
    assert.throws(() => service.reserveForSetup(), /SETUP_ENGINE_BUSY/u);
    release();
    await service.start(configuration);
    assert.throws(() => service.reserveForSetup(), /SETUP_ENGINE_BUSY/u);
    assert.equal(service.status().engineAlive, true);
    await service.stop();
  });
  it('shares one in-flight startup across concurrent runtime requests', async () => {
    let releaseLocation: ((value: SpssInstallation) => void) | undefined;
    let locateCount = 0;
    let managerCount = 0;
    let spawnCount = 0;
    const location = new Promise<SpssInstallation>((resolve) => {
      releaseLocation = resolve;
    });
    const service = new EngineService('/extension', { onStateChange: () => undefined, onDiagnostic: () => undefined }, {
      locate: async () => {
        locateCount += 1;
        return location;
      },
      createManager: (options) => {
        managerCount += 1;
        return new BridgeManager({
          ...options,
          platform: 'win32',
          environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
          spawner: () => {
            spawnCount += 1;
            return new ResponsiveBridgeProcess();
          },
        });
      },
    });

    const run = service.run('FREQUENCIES VARIABLES=id.', { runId: 'run-1', outputDirectory: 'C:\\Temp\\run-1' }, configuration);
    const metadata = service.datasetInfo(configuration);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(locateCount, 1);
    releaseLocation?.(installation);

    const [runResponse, dataset] = await Promise.all([run, metadata]);
    assert.equal(runResponse.status, 'SUCCESS');
    assert.equal(dataset.datasetName, 'DataSet1');
    assert.equal(managerCount, 1);
    assert.equal(spawnCount, 1);
    await service.stop();
  });

  it('cleans up and retries one timed-out startup with a fresh manager', async () => {
    let managerCount = 0;
    let spawnCount = 0;
    const diagnostics: string[] = [];
    const terminatedProcessTrees: number[] = [];
    const service = new EngineService('/extension', {
      onStateChange: () => undefined,
      onDiagnostic: (message) => diagnostics.push(message),
    }, {
      locate: () => Promise.resolve(installation),
      createManager: (options) => {
        managerCount += 1;
        const attempt = managerCount;
        return new BridgeManager({
          ...options,
          startupTimeoutMs: 20,
          platform: 'win32',
          environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
          processTreeTerminator: (processId) => {
            terminatedProcessTrees.push(processId);
            return { success: true };
          },
          spawner: () => {
            spawnCount += 1;
            return attempt === 1 ? new SilentBridgeProcess() : new ResponsiveBridgeProcess();
          },
        });
      },
    });

    const response = await service.start(configuration);
    assert.equal(response.engineAlive, true);
    assert.equal(managerCount, 2);
    assert.equal(spawnCount, 2);
    assert.deepEqual(terminatedProcessTrees, [7300]);
    assert.match(diagnostics.join('\n'), /retrying once/iu);
    await service.stop();
    assert.deepEqual(terminatedProcessTrees, [7300, 7200]);
  });

  it('does not retry a deterministic SPSS import failure', async () => {
    let managerCount = 0;
    const service = new EngineService('/extension', { onStateChange: () => undefined, onDiagnostic: () => undefined }, {
      locate: () => Promise.resolve(installation),
      createManager: (options) => {
        managerCount += 1;
        return new BridgeManager({
          ...options,
          platform: 'darwin',
          spawner: () => new ResponsiveBridgeProcess((request) => ({
            ...responseFor(request),
            ok: false,
            engineAlive: false,
            error: 'Unable to import IBM SPSS Python module: No module named spss',
          })),
        });
      },
    });

    await assert.rejects(service.start(configuration), /Unable to import IBM SPSS Python module/iu);
    assert.equal(managerCount, 1);
  });
});
