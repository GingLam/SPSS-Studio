import { randomUUID } from 'node:crypto';
import type { KeyValueStore, SecretValueStore } from './providerConfigurationStore';
import {
  MODEL_PROFILE_INDEX_KEY,
  MODEL_PROFILE_SCHEMA_VERSION,
  parseModelProfileIndex,
  profileSecretKey,
  validateModelProfileDraft,
  type ModelProfile,
  type ModelProfileDraft,
  type ModelProfileIndex,
  type ModelProfileState,
  type ResolvedModelProfile,
} from './modelProfile';

interface ModelProfileStoreOptions {
  createId?: () => string;
  now?: () => Date;
}

export class ModelProfileStore {
  private readonly createId: () => string;
  private readonly now: () => Date;

  public constructor(
    private readonly values: KeyValueStore,
    private readonly secrets: SecretValueStore,
    options: ModelProfileStoreOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  public async state(): Promise<ModelProfileState> {
    const index = this.readIndex();
    const stored = this.values.get(MODEL_PROFILE_INDEX_KEY) as { schemaVersion?: unknown } | undefined;
    if (stored?.schemaVersion !== undefined && stored.schemaVersion !== MODEL_PROFILE_SCHEMA_VERSION) {
      await this.values.update(MODEL_PROFILE_INDEX_KEY, index);
    }
    const profiles = await Promise.all(index.profiles.map(async (profile) => ({
      ...profile,
      hasApiKey: Boolean(await this.secrets.get(profileSecretKey(profile.id))),
    })));
    return index.activeProfileId === undefined
      ? { profiles }
      : { activeProfileId: index.activeProfileId, profiles };
  }

  public async create(draft: ModelProfileDraft, apiKey?: string): Promise<ModelProfile> {
    const validated = validateModelProfileDraft(draft);
    const index = this.readIndex();
    const id = this.createId();
    const timestamp = this.now().toISOString();
    const profile: ModelProfile = {
      id,
      name: validated.name,
      providerId: validated.providerId,
      baseUrl: validated.baseUrl,
      model: validated.model,
      reasoningEnabled: validated.reasoningEnabled,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const next: ModelProfileIndex = {
      schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
      activeProfileId: index.activeProfileId ?? id,
      profiles: [...index.profiles, profile],
    };
    await this.values.update(MODEL_PROFILE_INDEX_KEY, next);
    await this.storeSuppliedKey(id, apiKey);
    return profile;
  }

  public async update(profileId: string, draft: ModelProfileDraft, apiKey?: string): Promise<ModelProfile> {
    const validated = validateModelProfileDraft(draft);
    const index = this.readIndex();
    const existing = this.requireProfile(index, profileId);
    const updated: ModelProfile = {
      ...existing,
      name: validated.name,
      providerId: validated.providerId,
      baseUrl: validated.baseUrl,
      model: validated.model,
      reasoningEnabled: validated.reasoningEnabled,
      updatedAt: this.now().toISOString(),
    };
    await this.writeIndex({
      ...index,
      profiles: index.profiles.map((profile) => profile.id === profileId ? updated : profile),
    });
    await this.storeSuppliedKey(profileId, apiKey);
    return updated;
  }

  public async duplicate(profileId: string, name?: string): Promise<ModelProfile> {
    const index = this.readIndex();
    const existing = this.requireProfile(index, profileId);
    const copy = await this.create({
      name: name?.trim() || `${existing.name} (2)`,
      providerId: existing.providerId,
      baseUrl: existing.baseUrl,
      model: existing.model,
      reasoningEnabled: existing.reasoningEnabled,
    });
    const key = await this.secrets.get(profileSecretKey(existing.id));
    if (key) {
      await this.secrets.store(profileSecretKey(copy.id), key);
    }
    return copy;
  }

  public async select(profileId: string): Promise<void> {
    const index = this.readIndex();
    this.requireProfile(index, profileId);
    await this.writeIndex({ ...index, activeProfileId: profileId });
  }

  public async delete(profileId: string): Promise<void> {
    const index = this.readIndex();
    this.requireProfile(index, profileId);
    const profiles = index.profiles.filter((profile) => profile.id !== profileId);
    const activeProfileId = index.activeProfileId === profileId
      ? profiles[0]?.id
      : index.activeProfileId;
    const next: ModelProfileIndex = activeProfileId === undefined
      ? { schemaVersion: MODEL_PROFILE_SCHEMA_VERSION, profiles }
      : { schemaVersion: MODEL_PROFILE_SCHEMA_VERSION, activeProfileId, profiles };
    await this.writeIndex(next);
    await this.secrets.delete(profileSecretKey(profileId));
  }

  public async deleteApiKey(profileId: string): Promise<void> {
    this.requireProfile(this.readIndex(), profileId);
    await this.secrets.delete(profileSecretKey(profileId));
  }

  public async resolve(profileId?: string): Promise<ResolvedModelProfile> {
    const index = this.readIndex();
    const id = profileId ?? index.activeProfileId;
    if (!id) {
      throw new Error('Configure an AI model profile before sending a question.');
    }
    const profile = this.requireProfile(index, id);
    const apiKey = await this.secrets.get(profileSecretKey(profile.id));
    if (!apiKey) {
      throw new Error(`Enter an API Key for the AI model profile “${profile.name}”.`);
    }
    return {
      profile,
      configuration: {
        providerId: profile.providerId,
        baseUrl: profile.baseUrl,
        model: profile.model,
      },
      apiKey,
    };
  }

  public readStoredIndex(): ModelProfileIndex {
    return this.readIndex();
  }

  public async replaceIndex(index: ModelProfileIndex): Promise<void> {
    const validated = parseModelProfileIndex(index);
    if (!validated) {
      throw new Error('The AI model profile index is missing.');
    }
    await this.values.update(MODEL_PROFILE_INDEX_KEY, validated);
  }

  private readIndex(): ModelProfileIndex {
    return parseModelProfileIndex(this.values.get(MODEL_PROFILE_INDEX_KEY)) ?? {
      schemaVersion: MODEL_PROFILE_SCHEMA_VERSION,
      profiles: [],
    };
  }

  private requireProfile(index: ModelProfileIndex, profileId: string): ModelProfile {
    const profile = index.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      throw new Error('The selected AI model profile no longer exists.');
    }
    return profile;
  }

  private async writeIndex(index: ModelProfileIndex): Promise<void> {
    const validated = parseModelProfileIndex(index);
    if (!validated) {
      throw new Error('The AI model profile index is missing.');
    }
    await this.values.update(MODEL_PROFILE_INDEX_KEY, validated);
  }

  private async storeSuppliedKey(profileId: string, apiKey?: string): Promise<void> {
    const supplied = apiKey?.trim();
    if (supplied) {
      await this.secrets.store(profileSecretKey(profileId), supplied);
    }
  }
}
