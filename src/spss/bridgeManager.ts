import { spawn, spawnSync, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { EventEmitter } from 'node:events';
import { ExecutionQueue } from './executionQueue';
import type { SpssInstallation } from './platform/types';
import type {
  ActiveDatasetInfo,
  BridgeOperation,
  BridgeRequest,
  BridgeResponse,
  DatasetPage,
  DatasetPageRequest,
  EngineState,
  EngineStatus,
  RunOutputTarget,
  VariableProfiles,
} from './types';

export interface BridgeProcess extends EventEmitter {
  readonly pid?: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
}

export type ProcessSpawner = (
  executable: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => BridgeProcess;

export interface ProcessTreeTerminationResult {
  success: boolean;
  error?: string;
}

export type ProcessTreeTerminator = (processId: number) => ProcessTreeTerminationResult;

export interface BridgeManagerOptions {
  startupTimeoutMs: number;
  executionTimeoutMs: number;
  shutdownTimeoutMs?: number;
  debug?: boolean;
  onStateChange?: (state: EngineState) => void;
  onDiagnostic?: (message: string) => void;
  spawner?: ProcessSpawner;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  processTreeTerminator?: ProcessTreeTerminator;
}

interface PendingRequest {
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const WINDOWS_PYTHON_ENVIRONMENT_OVERRIDES = new Set([
  'CONDA_DEFAULT_ENV',
  'CONDA_PREFIX',
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'PYTHONUSERBASE',
  'VIRTUAL_ENV',
]);

function defaultSpawner(
  executable: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): BridgeProcess {
  return spawn(executable, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] }) as BridgeProcess;
}

function windowsProcessTreeTerminator(environment: NodeJS.ProcessEnv): ProcessTreeTerminator {
  return (processId) => {
    const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
    const executable = systemRoot
      ? path.win32.join(systemRoot, 'System32', 'taskkill.exe')
      : 'taskkill.exe';
    const result = spawnSync(executable, ['/PID', String(processId), '/T', '/F'], {
      windowsHide: true,
      timeout: 5_000,
      stdio: 'ignore',
      shell: false,
    });
    if (result.error) {
      return { success: false, error: result.error.message };
    }
    return result.status === 0
      ? { success: true }
      : { success: false, error: `taskkill exited with status ${String(result.status)}` };
  };
}

function isBridgeResponse(value: unknown): value is BridgeResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<BridgeResponse>;
  return typeof candidate.id === 'string'
    && typeof candidate.ok === 'boolean'
    && typeof candidate.errorLevel === 'number'
    && typeof candidate.output === 'string'
    && Array.isArray(candidate.warnings)
    && (candidate.error === null || typeof candidate.error === 'string')
    && typeof candidate.durationMs === 'number';
}

export class BridgeManager {
  private readonly queue = new ExecutionQueue();
  private readonly spawner: ProcessSpawner;
  private readonly platform: NodeJS.Platform;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly processTreeTerminator: ProcessTreeTerminator;
  private readonly pending = new Map<string, PendingRequest>();
  private child: BridgeProcess | undefined;
  private stdoutBuffer = '';
  private currentState: EngineState = 'stopped';
  private lastError: string | undefined;

  public constructor(private readonly options: BridgeManagerOptions) {
    this.spawner = options.spawner ?? defaultSpawner;
    this.platform = options.platform ?? process.platform;
    this.environment = options.environment ?? process.env;
    this.processTreeTerminator = options.processTreeTerminator ?? windowsProcessTreeTerminator(this.environment);
  }

  public get state(): EngineState {
    return this.currentState;
  }

  public status(): EngineStatus {
    return {
      state: this.currentState,
      engineAlive: this.child !== undefined && (this.currentState === 'ready' || this.currentState === 'running'),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.child?.pid ? { processId: this.child.pid } : {}),
    };
  }

  private setState(state: EngineState, error?: string): void {
    this.currentState = state;
    if (error !== undefined) {
      this.lastError = error;
    } else if (state !== 'error') {
      this.lastError = undefined;
    }
    this.options.onStateChange?.(state);
  }

  private diagnostic(message: string): void {
    this.options.onDiagnostic?.(message);
  }

  private spawnEnvironment(installation: SpssInstallation): NodeJS.ProcessEnv {
    const sanitizeWindowsPython = this.platform === 'win32' && installation.launchMode === 'ibm-launcher';
    const environment = sanitizeWindowsPython
      ? Object.fromEntries(
        Object.entries(this.environment)
          .filter(([key]) => !WINDOWS_PYTHON_ENVIRONMENT_OVERRIDES.has(key.toUpperCase())),
      )
      : { ...this.environment };
    if (sanitizeWindowsPython) {
      environment.PYTHONUTF8 = '1';
      environment.PYTHONIOENCODING = 'utf-8';
    }
    return {
      ...environment,
      ...installation.environment,
      ...(this.options.debug ? { SPSS_STUDIO_DEBUG: '1' } : {}),
    };
  }

  private launchCommand(
    installation: SpssInstallation,
    bridgePath: string,
  ): { executable: string; args: string[]; cwd: string } {
    if (this.platform === 'win32' && installation.pythonLauncher.toLowerCase().endsWith('.bat')) {
      const commandInterpreter = this.environment.ComSpec ?? 'cmd.exe';
      const command = `"${installation.pythonLauncher.replaceAll('"', '""')}" "${bridgePath.replaceAll('"', '""')}"`;
      return {
        executable: commandInterpreter,
        args: ['/d', '/s', '/c', command],
        cwd: installation.installRoot,
      };
    }
    return {
      executable: installation.pythonLauncher,
      args: [bridgePath],
      cwd: installation.launchMode === 'ibm-launcher' && this.platform === 'darwin'
        ? path.dirname(installation.pythonLauncher)
        : installation.installRoot,
    };
  }

  public async start(installation: SpssInstallation, bridgePath: string): Promise<BridgeResponse> {
    if (this.child && (this.currentState === 'ready' || this.currentState === 'running')) {
      return this.request('status', undefined, this.options.startupTimeoutMs);
    }
    if (this.child) {
      this.terminateChild();
    }

    this.setState('starting');
    const launch = this.launchCommand(installation, bridgePath);
    let child: BridgeProcess;
    try {
      child = this.spawner(launch.executable, launch.args, {
        cwd: launch.cwd,
        env: this.spawnEnvironment(installation),
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      const message = `Could not spawn SPSS bridge: ${error instanceof Error ? error.message : String(error)}`;
      this.setState('error', message);
      throw new Error(message, { cause: error });
    }
    this.child = child;
    this.stdoutBuffer = '';
    child.stdout.on('data', (chunk: Buffer | string) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: Buffer | string) => {
      const message = chunk.toString().trimEnd();
      if (message) {
        this.diagnostic(message);
      }
    });
    child.on('error', (error: Error) => {
      this.failProcess(`SPSS bridge process error: ${error.message}`);
      this.terminateChild();
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.child === child) {
        this.failProcess(`SPSS bridge exited (code=${String(code)}, signal=${String(signal)}).`);
        this.child = undefined;
      }
    });

    try {
      const response = await this.request('ping', undefined, this.options.startupTimeoutMs);
      if (!response.ok || response.engineAlive !== true) {
        throw new Error(response.error ?? 'IBM SPSS Statistics did not become ready.');
      }
      this.setState('ready');
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState('error', message);
      this.terminateChild();
      throw error;
    }
  }

  private enqueueOperation(
    operation: BridgeOperation,
    payload: Omit<BridgeRequest, 'id' | 'op'>,
  ): Promise<BridgeResponse> {
    return this.queue.enqueue(async () => {
      if (!this.child || (this.currentState !== 'ready' && this.currentState !== 'running')) {
        throw new Error('SPSS engine is not ready.');
      }
      this.setState('running');
      try {
        const response = await this.request(operation, payload, this.options.executionTimeoutMs);
        if (response.engineAlive === false) {
          this.setState('error', response.error ?? 'IBM SPSS Statistics processor is no longer alive.');
          this.terminateChild();
        } else {
          this.setState('ready', response.error ?? undefined);
        }
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.setState('error', message);
        throw error;
      }
    });
  }

  public run(syntax: string, target: RunOutputTarget): Promise<BridgeResponse> {
    return this.enqueueOperation('run', {
      syntax,
      runId: target.runId,
      outputDirectory: target.outputDirectory,
    });
  }

  public async datasetInfo(): Promise<ActiveDatasetInfo> {
    const response = await this.enqueueOperation('datasetInfo', {});
    if (!response.ok || !response.datasetInfo) {
      throw new Error(response.error ?? 'SPSS did not return Active Dataset metadata.');
    }
    return response.datasetInfo;
  }

  public async datasetPage(page: DatasetPageRequest): Promise<DatasetPage> {
    const response = await this.enqueueOperation('datasetPage', page);
    if (!response.ok || !response.datasetPage) {
      throw new Error(response.error ?? 'SPSS did not return the requested dataset page.');
    }
    return response.datasetPage;
  }

  public async variableProfiles(variableNames: readonly string[]): Promise<VariableProfiles> {
    const response = await this.enqueueOperation('variableProfiles', {
      variableNames: [...variableNames],
    });
    if (!response.ok || !response.variableProfiles) {
      throw new Error(response.error ?? 'SPSS did not return variable profiles.');
    }
    return response.variableProfiles;
  }

  public async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.setState('stopped');
      return;
    }
    try {
      await this.request('shutdown', undefined, this.options.shutdownTimeoutMs ?? 5_000);
    } catch (error) {
      this.diagnostic(`Graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (this.child === child) {
        this.terminateChild();
      }
      this.setState('stopped');
    }
  }

  public async restart(installation: SpssInstallation, bridgePath: string): Promise<BridgeResponse> {
    await this.stop();
    return this.start(installation, bridgePath);
  }

  private request(
    op: BridgeOperation,
    payload: Omit<BridgeRequest, 'id' | 'op'> | undefined,
    timeoutMs: number,
  ): Promise<BridgeResponse> {
    const child = this.child;
    if (!child) {
      return Promise.reject(new Error('SPSS bridge process is not running.'));
    }
    const id = randomUUID();
    const request: BridgeRequest = { id, op, ...payload };
    return new Promise<BridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`SPSS bridge request ${op} timed out after ${String(timeoutMs)} ms.`);
        reject(error);
        this.failProcess(error.message);
        this.terminateChild();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
          this.failProcess(`Could not write to SPSS bridge: ${error.message}`);
          this.terminateChild();
        }
      });
    });
  }

  private onStdout(chunk: Buffer | string): void {
    this.stdoutBuffer += chunk.toString();
    let newline = this.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line) {
        this.handleResponseLine(line);
      }
      newline = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleResponseLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      this.failProcess(`Malformed JSON from SPSS bridge: ${error instanceof Error ? error.message : String(error)}`);
      this.terminateChild();
      return;
    }
    if (!isBridgeResponse(parsed)) {
      this.failProcess('Malformed response object from SPSS bridge.');
      this.terminateChild();
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) {
      this.diagnostic(`Ignoring orphan SPSS bridge response id ${parsed.id}.`);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(parsed.id);
    pending.resolve(parsed);
  }

  private failProcess(message: string): void {
    if (!this.child && this.pending.size === 0) {
      return;
    }
    this.setState('error', message);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  private terminateChild(): void {
    const child = this.child;
    this.child = undefined;
    if (child) {
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      let treeTerminated = false;
      if (this.platform === 'win32' && child.pid && Number.isSafeInteger(child.pid) && child.pid > 0) {
        try {
          const result = this.processTreeTerminator(child.pid);
          treeTerminated = result.success;
          if (!result.success) {
            this.diagnostic(`Windows process-tree cleanup failed for PID ${String(child.pid)}: ${result.error ?? 'unknown error'}`);
          }
        } catch (error) {
          this.diagnostic(`Windows process-tree cleanup failed for PID ${String(child.pid)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!treeTerminated) {
        try {
          child.kill('SIGTERM');
        } catch (error) {
          this.diagnostic(`SPSS bridge child termination failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
}
