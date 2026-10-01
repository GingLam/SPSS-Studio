import {
  providerPreset,
  validateProviderConfiguration,
  type AiProviderConfiguration,
  type AiProviderId,
} from './providerPresets';

export const LEGACY_PROVIDER_CONFIGURATION_KEY = 'spssStudio.ai.providerConfiguration';
export const LEGACY_PROVIDER_SECRET_PREFIX = 'spssStudio.ai.apiKey.';

export interface KeyValueStore {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SecretValueStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export interface ProviderConfigurationState {
  configuration: AiProviderConfiguration;
  configured: boolean;
  hasApiKey: boolean;
}

export interface ResolvedProviderConfiguration {
  configuration: AiProviderConfiguration;
  apiKey: string;
}

export class ProviderConfigurationStore {
  public constructor(
    private readonly values: KeyValueStore,
    private readonly secrets: SecretValueStore,
  ) {}

  public async state(): Promise<ProviderConfigurationState> {
    const stored = this.readStored();
    const configuration = stored ?? this.defaultDraft();
    return {
      configuration,
      configured: stored !== undefined,
      hasApiKey: Boolean(await this.secrets.get(this.secretKey(configuration.providerId))),
    };
  }

  public async save(configuration: AiProviderConfiguration, apiKey?: string): Promise<void> {
    const validated = validateProviderConfiguration(configuration);
    await this.values.update(LEGACY_PROVIDER_CONFIGURATION_KEY, validated);
    const suppliedKey = apiKey?.trim();
    if (suppliedKey) {
      await this.secrets.store(this.secretKey(validated.providerId), suppliedKey);
    }
  }

  public async deleteApiKey(providerId: AiProviderId): Promise<void> {
    await this.secrets.delete(this.secretKey(providerId));
  }

  public async resolve(): Promise<ResolvedProviderConfiguration> {
    const stored = this.readStored();
    if (!stored) {
      throw new Error('Configure an AI provider before sending a question.');
    }
    const configuration = validateProviderConfiguration(stored);
    const apiKey = await this.secrets.get(this.secretKey(configuration.providerId));
    if (!apiKey) {
      throw new Error('Enter an API Key for the selected AI provider.');
    }
    return { configuration, apiKey };
  }

  private readStored(): AiProviderConfiguration | undefined {
    const value = this.values.get(LEGACY_PROVIDER_CONFIGURATION_KEY);
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.providerId !== 'string'
      || typeof candidate.baseUrl !== 'string'
      || typeof candidate.model !== 'string'
    ) {
      return undefined;
    }
    try {
      return validateProviderConfiguration({
        providerId: candidate.providerId as AiProviderId,
        baseUrl: candidate.baseUrl,
        model: candidate.model,
      });
    } catch {
      return undefined;
    }
  }

  private defaultDraft(): AiProviderConfiguration {
    const preset = providerPreset('deepseek');
    return { providerId: preset.id, baseUrl: preset.baseUrl, model: '' };
  }

  private secretKey(providerId: AiProviderId): string {
    return legacyProviderSecretKey(providerId);
  }
}

export function legacyProviderSecretKey(providerId: AiProviderId): string {
  return `${LEGACY_PROVIDER_SECRET_PREFIX}${providerId}`;
}
