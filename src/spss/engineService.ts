import path from 'node:path';
import { BridgeManager } from './bridgeManager';
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

export class EngineService {
  private manager: BridgeManager | undefined;
  private installation: SpssInstallation | undefined;
  private lastError: string | undefined;

  public constructor(
    private readonly extensionRoot: string,
    private readonly callbacks: EngineServiceCallbacks,
  ) {}

  private bridgePath(): string {
    return path.join(this.extensionRoot, 'resources', 'bridge', 'spss_bridge.py');
  }

  public async start(configuration: SpssRuntimeConfiguration): Promise<BridgeResponse> {
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

    this.installation = await locateSpss({
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

    this.manager = new BridgeManager({
      startupTimeoutMs: configuration.startupTimeoutSeconds * 1_000,
      executionTimeoutMs: configuration.executionTimeoutSeconds * 1_000,
      debug: configuration.debugLogging,
      onStateChange: this.callbacks.onStateChange,
      onDiagnostic: this.callbacks.onDiagnostic,
    });
    try {
      const response = await this.manager.start(this.installation, this.bridgePath());
      this.lastError = undefined;
      return response;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
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

  public async stop(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
    } else {
      this.callbacks.onStateChange('stopped');
    }
  }

  public async restart(configuration: SpssRuntimeConfiguration): Promise<BridgeResponse> {
    await this.stop();
    this.manager = undefined;
    return this.start(configuration);
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
