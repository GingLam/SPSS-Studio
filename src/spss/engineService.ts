import path from 'node:path';
import { BridgeManager, type BridgeManagerOptions } from './bridgeManager';
import { locateSpss } from './spssLocator';
import type { SpssInstallation } from './platform/types';
import type {
  ActiveDatasetInfo,
  BridgeResponse,
  DatasetPage,
  DatasetPageRequest,
  EngineState,
  EngineStatus,
  RunOutputTarget,
  VariableProfiles,
} from './types';

export interface SpssRuntimeConfiguration {
  installPath: string;
  pythonLauncherPath: string;
  startupTimeoutSeconds: number;
  executionTimeoutSeconds: number;
  dataPreviewPageSize: number;
  autoStart: boolean;
  debugLogging: boolean;
}

export interface EngineServiceCallbacks {
  onStateChange: (state: EngineState) => void;
  onDiagnostic: (message: string) => void;
}

export interface EngineServiceDependencies {
  locate: typeof locateSpss;
  createManager: (options: BridgeManagerOptions) => BridgeManager;
}

export class EngineService {
  private manager: BridgeManager | undefined;
  private installation: SpssInstallation | undefined;
  private lastError: string | undefined;
  private startPromise: Promise<BridgeResponse> | undefined;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private readonly locate: typeof locateSpss;
  private readonly createManager: (options: BridgeManagerOptions) => BridgeManager;

  public constructor(
    private readonly extensionRoot: string,
    private readonly callbacks: EngineServiceCallbacks,
    dependencies: Partial<EngineServiceDependencies> = {},
  ) {
    this.locate = dependencies.locate ?? locateSpss;
    this.createManager = dependencies.createManager ?? ((options) => new BridgeManager(options));
  }

  private bridgePath(): string {
    return path.join(this.extensionRoot, 'resources', 'bridge', 'spss_bridge.py');
  }

  private static isRetryableStartupError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /timed out|SPSS bridge exited|\b(?:EBUSY|EAGAIN|ETIMEDOUT)\b/iu.test(message);
  }

  private newManager(configuration: SpssRuntimeConfiguration): BridgeManager {
    return this.createManager({
      startupTimeoutMs: configuration.startupTimeoutSeconds * 1_000,
      executionTimeoutMs: configuration.executionTimeoutSeconds * 1_000,
      debug: configuration.debugLogging,
      onStateChange: this.callbacks.onStateChange,
      onDiagnostic: this.callbacks.onDiagnostic,
    });
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private trackStartup(pending: Promise<BridgeResponse>): Promise<BridgeResponse> {
    this.startPromise = pending;
    const clear = (): void => {
      if (this.startPromise === pending) {
        this.startPromise = undefined;
      }
    };
    void pending.then(clear, clear);
    return pending;
  }

  public start(configuration: SpssRuntimeConfiguration): Promise<BridgeResponse> {
    if (this.startPromise) {
      return this.startPromise;
    }
    return this.trackStartup(this.enqueueLifecycle(() => this.startFresh(configuration)));
  }

  private async startFresh(configuration: SpssRuntimeConfiguration): Promise<BridgeResponse> {
    if (this.manager && (this.manager.state === 'ready' || this.manager.state === 'running')) {
      const status = this.manager.status();
      return {
        id: 'local-status',
        ok: status.engineAlive,
        errorLevel: status.engineAlive ? 0 : 3,
        output: '',
        warnings: [],
        error: status.lastError ?? null,
        durationMs: 0,
        engineAlive: status.engineAlive,
      };
    }
    if (this.manager) {
      await this.manager.stop();
      this.manager = undefined;
    }

    this.installation = await this.locate({
      options: {
        ...(configuration.installPath ? { explicitInstallPath: configuration.installPath } : {}),
        ...(configuration.pythonLauncherPath
          ? { explicitPythonLauncherPath: configuration.pythonLauncherPath }
          : {}),
      },
    });
    if (!this.installation) {
      this.lastError = 'IBM SPSS Statistics was not found. Configure spssStudio.installPath or spssStudio.pythonLauncherPath.';
      this.callbacks.onStateChange('error');
      throw new Error(this.lastError);
    }

    let lastStartupError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const manager = this.newManager(configuration);
      this.manager = manager;
      try {
        const response = await manager.start(this.installation, this.bridgePath());
        this.lastError = undefined;
        return response;
      } catch (error) {
        lastStartupError = error;
        this.lastError = error instanceof Error ? error.message : String(error);
        const retry = attempt === 1 && EngineService.isRetryableStartupError(error);
        try {
          await manager.stop();
        } catch (cleanupError) {
          this.callbacks.onDiagnostic(`SPSS startup cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
        }
        if (this.manager === manager) {
          this.manager = undefined;
        }
        if (!retry) {
          throw error;
        }
        this.callbacks.onDiagnostic(`Transient SPSS startup failure; retrying once: ${this.lastError}`);
      }
    }
    throw lastStartupError instanceof Error ? lastStartupError : new Error(String(lastStartupError));
  }

  public async run(
    syntax: string,
    target: RunOutputTarget,
    configuration: SpssRuntimeConfiguration,
  ): Promise<BridgeResponse> {
    const manager = await this.readyManager(configuration);
    try {
      const response = await manager.run(syntax, target);
      this.lastError = response.error ?? undefined;
      return response;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async readyManager(configuration: SpssRuntimeConfiguration): Promise<BridgeManager> {
    if (!this.manager || (this.manager.state !== 'ready' && this.manager.state !== 'running')) {
      if (!configuration.autoStart) {
        throw new Error('SPSS engine is stopped. Run “SPSS: Start Engine” or enable spssStudio.autoStart.');
      }
      await this.start(configuration);
    }
    const manager = this.manager;
    if (!manager) {
      throw new Error('SPSS bridge manager was not initialized.');
    }
    return manager;
  }

  public async datasetInfo(configuration: SpssRuntimeConfiguration): Promise<ActiveDatasetInfo> {
    return (await this.readyManager(configuration)).datasetInfo();
  }

  public async datasetPage(
    page: DatasetPageRequest,
    configuration: SpssRuntimeConfiguration,
  ): Promise<DatasetPage> {
    return (await this.readyManager(configuration)).datasetPage(page);
  }

  public async variableProfiles(
    variableNames: readonly string[],
    configuration: SpssRuntimeConfiguration,
  ): Promise<VariableProfiles> {
    return (await this.readyManager(configuration)).variableProfiles(variableNames);
  }

  public stop(): Promise<void> {
    return this.enqueueLifecycle(() => this.stopFresh());
  }

  private async stopFresh(): Promise<void> {
    const manager = this.manager;
    if (manager) {
      await manager.stop();
      if (this.manager === manager) {
        this.manager = undefined;
      }
    } else {
      this.callbacks.onStateChange('stopped');
    }
  }

  public restart(configuration: SpssRuntimeConfiguration): Promise<BridgeResponse> {
    const pending = this.enqueueLifecycle(async () => {
      await this.stopFresh();
      return this.startFresh(configuration);
    });
    return this.trackStartup(pending);
  }

  public status(): EngineStatus & { installation?: SpssInstallation } {
    const managerStatus = this.manager?.status() ?? {
      state: 'stopped' as const,
      engineAlive: false,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
    return {
      ...managerStatus,
      ...(this.installation ? { installation: this.installation } : {}),
    };
  }
}
