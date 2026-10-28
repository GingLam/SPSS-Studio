import { spawn, spawnSync, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
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
  private stdoutDecoder = new StringDecoder('utf8');
  private readonly stderrChunks: Buffer[] = [];
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

  private spawnEnvironment(installation: SpssInstallation, bridgePath: string): NodeJS.ProcessEnv {
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
      ...(this.platform === 'win32' ? {
        SPSS_STUDIO_LAUNCHER: installation.pythonLauncher,
        SPSS_STUDIO_BRIDGE: bridgePath,
      } : {}),
      ...(this.options.debug ? { SPSS_STUDIO_DEBUG: '1' } : {}),
    };
  }

  private launchCommand(
    installation: SpssInstallation,
    bridgePath: string,
  ): { executable: string; args: string[]; cwd: string } {
    if (this.platform === 'win32' && installation.pythonLauncher.toLowerCase().endsWith('.bat')) {
      const commandInterpreter = this.environment.ComSpec ?? 'cmd.exe';
      if ([installation.pythonLauncher, bridgePath].some((value) => /["\r\n\0]/u.test(value))) {
        throw new Error('Invalid characters in SPSS launcher or bridge path.');
      }
      if ([installation.pythonLauncher, bridgePath].some((value) => value.includes('%'))) {
        throw new Error('Windows SPSS/extension paths containing literal % are unsupported because IBM batch CALL expands them. Use paths without percent signs.');
      }
      // CMD requires its own outer quotes; libuv must not escape them as \".
      // Paths stay out of CMD source; literal % is rejected before IBM's CALL reparses it.
      const command = '""%SPSS_STUDIO_LAUNCHER%" "%SPSS_STUDIO_BRIDGE%""';
      return {
        executable: commandInterpreter,
        args: ['/d', '/s', '/v:off', '/c', command],
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
    let child: BridgeProcess;
    try {
      const launch = this.launchCommand(installation, bridgePath);
      child = this.spawner(launch.executable, launch.args, {
        cwd: launch.cwd,
        env: this.spawnEnvironment(installation, bridgePath),
        ...(this.platform === 'win32' ? { windowsVerbatimArguments: true } : {}),
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
    this.stdoutDecoder = new StringDecoder('utf8');
    this.stderrChunks.length = 0;
    child.stdout.on('data', (chunk: Buffer | string) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.stderrChunks.push(bytes);
      if (this.stderrChunks.reduce((total, item) => total + item.length, 0) > 16_384) {
        this.stderrChunks.shift();
      }
      const message = bytes.toString('utf8').trimEnd();
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
        const raw = Buffer.concat(this.stderrChunks);
        let detail = raw.toString('utf8');
        if (this.platform === 'win32' && detail.includes('\uFFFD')) {
          // IBM Python uses UTF-8, while CMD on Chinese Windows may still emit GBK.
          try { detail = new TextDecoder('gb18030').decode(raw); } catch { /* Keep original bytes' UTF-8 view. */ }
        }
        this.failProcess(`SPSS bridge exited (code=${String(code)}, signal=${String(signal)}).${detail.trim() ? ` ${detail.trim().slice(0, 2000)}` : ''}`);
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

  public clearData(): Promise<BridgeResponse> {
    return this.enqueueOperation('clearData', {});
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

  public async stop(requireGraceful = false): Promise<void> {
    const child = this.child;
    if (!child) {
      if (requireGraceful) { throw new Error('SPSS bridge exited before graceful shutdown could be verified.'); }
      this.setState('stopped');
      return;
    }
    let failure: Error | undefined;
    let cleaned = true;
    try {
      const response = await this.request('shutdown', undefined, this.options.shutdownTimeoutMs ?? 5_000);
      if (requireGraceful && (!response.ok || response.engineAlive !== false)) {
        throw new Error(response.error ?? 'SPSS did not confirm graceful shutdown.');
      }
      if (requireGraceful && this.child === child) {
        // Let a healthy bridge exit itself before invoking Windows taskkill.
        // This avoids treating "PID already exited" as a failed tree cleanup.
        await new Promise<void>((resolve) => {
          const finish = (): void => { clearTimeout(timer); child.off('close', finish); resolve(); };
          const timer = setTimeout(finish, 250);
          child.once('close', finish);
        });
      }
    } catch (error) {
      this.diagnostic(`Graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      failure = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (this.child === child) {
        cleaned = this.terminateChild();
      }
      this.setState('stopped');
    }
    if (requireGraceful && failure) { throw failure; }
    if (requireGraceful && !cleaned) { throw new Error('Windows process-tree cleanup could not be verified.'); }
  }

  public async restart(installation: SpssInstallation, bridgePath: string): Promise<BridgeResponse> {
    await this.stop();
    return this.start(installation, bridgePath);
  }

  public abort(): void {
    this.failProcess('SETUP_CANCELLED');
    this.terminateChild();
    this.setState('stopped');
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
    this.stdoutBuffer += Buffer.isBuffer(chunk) ? this.stdoutDecoder.write(chunk) : chunk;
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

  private terminateChild(): boolean {
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
      return this.platform !== 'win32' || treeTerminated;
    }
    return true;
  }
}
