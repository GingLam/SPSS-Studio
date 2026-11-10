import { randomUUID } from 'node:crypto';
import { ExecutionQueue } from '../spss/executionQueue';
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
  private readonly queue = new ExecutionQueue();
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

  public state(): Promise<ModelProfileState> {
    return this.queue.enqueue(() => this.stateQueued());
  }

  private async stateQueued(): Promise<ModelProfileState> {
    const index = this.readIndex();
    const stored = this.values.get(MODEL_PROFILE_INDEX_KEY) as { schemaVersion?: unknown } | undefined;
    if (stored?.schemaVersion !== undefined && stored.schemaVersion !== MODEL_PROFILE_SCHEMA_VERSION) {
      await this.values.update(MODEL_PROFILE_INDEX_KEY, index);
    }
    const profiles = await Promise.all(index.profiles.map(async ({ credentialRevision, ...profile }) => ({
      ...profile,
      hasApiKey: Boolean(await this.secrets.get(profileSecretKey(profile.id, credentialRevision))),
    })));
    return {
      profiles,
      ...(index.activeProfileId === undefined ? {} : { activeProfileId: index.activeProfileId }),
      ...(index.codingProfileId === undefined ? {} : { codingProfileId: index.codingProfileId }),
    };
  }

  public create(draft: ModelProfileDraft, apiKey?: string): Promise<ModelProfile> {
    return this.queue.enqueue(() => this.createQueued(draft, apiKey));
  }

  private async createQueued(draft: ModelProfileDraft, apiKey?: string): Promise<ModelProfile> {
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
      ...index,
      activeProfileId: index.activeProfileId ?? id,
      profiles: [...index.profiles, profile],
    };
    const key = profileSecretKey(id);
    if (apiKey?.trim()) await this.secrets.store(key, apiKey.trim());
    try {
      await this.writeIndex(next);
    } catch (error) {
      if (apiKey?.trim()) await this.secrets.delete(key);
      throw error;
    }
    return profile;
  }

  public update(profileId: string, draft: ModelProfileDraft, apiKey?: string): Promise<ModelProfile> {
    return this.queue.enqueue(() => this.updateQueued(profileId, draft, apiKey));
  }

  private async updateQueued(profileId: string, draft: ModelProfileDraft, apiKey?: string): Promise<ModelProfile> {
    const validated = validateModelProfileDraft(draft);
    const index = this.readIndex();
    const existing = this.requireProfile(index, profileId);
    const changedEndpoint = this.endpointChanged(existing, validated);
    const supplied = apiKey?.trim();
    if (changedEndpoint && !supplied) {
      throw new Error('Enter a new API Key when changing the provider or Base URL.');
    }
    const updated: ModelProfile = {
      ...existing,
      name: validated.name,
      providerId: validated.providerId,
      baseUrl: validated.baseUrl,
      model: validated.model,
      reasoningEnabled: validated.reasoningEnabled,
      updatedAt: this.now().toISOString(),
      ...(changedEndpoint ? { credentialRevision: randomUUID() } : {}),
    };
    const key = this.secretKey(updated);
    const previousKey = this.secretKey(existing);
    if (supplied && changedEndpoint) await this.secrets.store(key, supplied);
    try {
      await this.writeIndex({
        ...index,
        profiles: index.profiles.map((profile) => profile.id === profileId ? updated : profile),
      });
    } catch (error) {
      if (changedEndpoint) await this.secrets.delete(key);
      throw error;
    }
    if (changedEndpoint) await this.secrets.delete(previousKey);
    else if (supplied) await this.secrets.store(key, supplied);
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
    const key = await this.secrets.get(this.secretKey(existing));
    if (key) {
      await this.secrets.store(profileSecretKey(copy.id), key);
    }
    return copy;
  }

  public select(profileId: string): Promise<void> {
    return this.queue.enqueue(() => this.selectQueued(profileId));
  }

  private async selectQueued(profileId: string): Promise<void> {
    const index = this.readIndex();
    this.requireProfile(index, profileId);
    await this.writeIndex({ ...index, activeProfileId: profileId });
  }

  public delete(profileId: string): Promise<void> {
    return this.queue.enqueue(() => this.deleteQueued(profileId));
  }

  private async deleteQueued(profileId: string): Promise<void> {
    const index = this.readIndex();
    this.requireProfile(index, profileId);
    const profiles = index.profiles.filter((profile) => profile.id !== profileId);
    const activeProfileId = index.activeProfileId === profileId
      ? profiles[0]?.id
      : index.activeProfileId;
    const { codingProfileId } = index;
    await this.writeIndex({
      schemaVersion: MODEL_PROFILE_SCHEMA_VERSION, profiles,
      ...(activeProfileId === undefined ? {} : { activeProfileId }),
      ...(codingProfileId === undefined || codingProfileId === profileId ? {} : { codingProfileId }),
    });
    await this.secrets.delete(this.secretKey(this.requireProfile(index, profileId)));
  }

  public deleteApiKey(profileId: string): Promise<void> {
    return this.queue.enqueue(() => this.deleteApiKeyQueued(profileId));
  }

  private async deleteApiKeyQueued(profileId: string): Promise<void> {
    await this.secrets.delete(this.secretKey(this.requireProfile(this.readIndex(), profileId)));
  }

  public async selectCoding(profileId: string, enabled: boolean): Promise<void> {
    await this.queue.enqueue(async () => {
      const { codingProfileId, ...index } = this.readIndex();
      const profile = this.requireProfile(index, profileId);
      if (enabled && !await this.secrets.get(this.secretKey(profile))) {
        throw new Error('Save an API Key before enabling the coding model.');
      }
      const id = enabled ? profileId : codingProfileId === profileId ? undefined : codingProfileId;
      if (id !== codingProfileId) {
        await this.writeIndex({ ...index, ...(id === undefined ? {} : { codingProfileId: id }) });
      }
    });
  }

  public async resolveCoding(): Promise<ResolvedModelProfile | undefined> {
    return this.queue.enqueue(async () => {
      const index = this.readIndex();
      return index.codingProfileId === undefined
        ? undefined
        : this.resolveFromIndex(index, index.codingProfileId);
    });
  }

  public async resolveDraft(draft: ModelProfileDraft, apiKey?: string, profileId?: string) {
    return this.queue.enqueue(async () => {
      const { providerId, baseUrl, model, reasoningEnabled } = validateModelProfileDraft(draft);
      const configuration = { providerId, baseUrl, model };
      let key = apiKey?.trim();
      if (!key && profileId) {
        const existing = this.requireProfile(this.readIndex(), profileId);
        if (this.endpointChanged(existing, configuration)) {
          throw new Error('Enter a new API Key when changing the provider or Base URL.');
        }
        key = await this.secrets.get(this.secretKey(existing));
      }
      if (!key) throw new Error('Enter an API Key for the selected AI provider.');
      return { configuration, apiKey: key, reasoningEnabled };
    });
  }

  public async resolve(profileId?: string): Promise<ResolvedModelProfile> {
    return this.queue.enqueue(async () => {
      const index = this.readIndex();
      const id = profileId ?? index.activeProfileId;
      if (!id) throw new Error('Configure an AI model profile before sending a question.');
      return this.resolveFromIndex(index, id);
    });
  }

  private async resolveFromIndex(index: ModelProfileIndex, id: string): Promise<ResolvedModelProfile> {
    const profile = this.requireProfile(index, id);
    const apiKey = await this.secrets.get(this.secretKey(profile));
    if (!apiKey) throw new Error(`Enter an API Key for the AI model profile “${profile.name}”.`);
    return {
      profile,
      configuration: { providerId: profile.providerId, baseUrl: profile.baseUrl, model: profile.model },
      apiKey,
    };
  }

  private secretKey(profile: ModelProfile): string {
    return profileSecretKey(profile.id, profile.credentialRevision);
  }

  private endpointChanged(saved: ModelProfile, draft: Pick<ModelProfileDraft, 'providerId' | 'baseUrl'>): boolean {
    return saved.providerId !== draft.providerId || saved.baseUrl !== draft.baseUrl;
  }

  public readStoredIndex(): ModelProfileIndex {
    return this.readIndex();
  }

  public replaceIndex(index: ModelProfileIndex): Promise<void> {
    return this.queue.enqueue(() => this.replaceIndexQueued(index));
  }

  private async replaceIndexQueued(index: ModelProfileIndex): Promise<void> {
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

}
