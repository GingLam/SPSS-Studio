import {
  providerPreset,
  validateProviderConfiguration,
  type AiProviderConfiguration,
  type AiProviderId,
} from './providerPresets';

export const MODEL_PROFILE_SCHEMA_VERSION = 2;
export const MODEL_PROFILE_INDEX_KEY = 'spssStudio.ai.modelProfiles';
export const MODEL_PROFILE_SECRET_PREFIX = 'spssStudio.ai.profile.';

export interface ModelProfile {
  id: string;
  name: string;
  providerId: AiProviderId;
  baseUrl: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelProfileView extends ModelProfile {
  hasApiKey: boolean;
}

export interface ModelProfileIndex {
  schemaVersion: typeof MODEL_PROFILE_SCHEMA_VERSION;
  activeProfileId?: string;
  profiles: ModelProfile[];
}

export interface ModelProfileDraft extends AiProviderConfiguration {
  name?: string;
}

export interface ModelProfileState {
  activeProfileId?: string;
  profiles: ModelProfileView[];
}

export interface ResolvedModelProfile {
  profile: ModelProfile;
  configuration: AiProviderConfiguration;
  apiKey: string;
}

export function defaultModelProfileName(configuration: AiProviderConfiguration): string {
  return `${providerPreset(configuration.providerId).label} · ${configuration.model.trim()}`;
}

export function validateModelProfileDraft(draft: ModelProfileDraft): ModelProfileDraft & { name: string } {
  const configuration = validateProviderConfiguration(draft);
  const name = (draft.name?.trim() || defaultModelProfileName(configuration)).trim();
  if (name.length > 120) {
    throw new Error('The AI model profile name must not exceed 120 characters.');
  }
  return { ...configuration, name };
}

export function profileSecretKey(profileId: string): string {
  if (!isProfileId(profileId)) {
    throw new Error('The AI model profile id is invalid.');
  }
  return `${MODEL_PROFILE_SECRET_PREFIX}${profileId}.apiKey`;
}

export function isProfileId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
}

export function parseModelProfileIndex(value: unknown): ModelProfileIndex | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored AI model profiles are invalid.');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== MODEL_PROFILE_SCHEMA_VERSION || !Array.isArray(candidate.profiles)) {
    throw new Error('Stored AI model profiles use an unsupported format.');
  }
  const profiles = candidate.profiles.map(parseModelProfile);
  const ids = new Set(profiles.map((profile) => profile.id));
  if (ids.size !== profiles.length) {
    throw new Error('Stored AI model profiles contain duplicate ids.');
  }
  const activeProfileId = candidate.activeProfileId;
  if (activeProfileId !== undefined && (!isProfileId(activeProfileId) || !ids.has(activeProfileId))) {
    throw new Error('The active AI model profile is invalid.');
  }
  return activeProfileId === undefined
    ? { schemaVersion: MODEL_PROFILE_SCHEMA_VERSION, profiles }
    : { schemaVersion: MODEL_PROFILE_SCHEMA_VERSION, activeProfileId, profiles };
}

function parseModelProfile(value: unknown): ModelProfile {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored AI model profile is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isProfileId(candidate.id)
    || typeof candidate.name !== 'string'
    || typeof candidate.providerId !== 'string'
    || typeof candidate.baseUrl !== 'string'
    || typeof candidate.model !== 'string'
    || typeof candidate.createdAt !== 'string'
    || typeof candidate.updatedAt !== 'string'
  ) {
    throw new Error('Stored AI model profile is incomplete.');
  }
  const validated = validateModelProfileDraft({
    name: candidate.name,
    providerId: candidate.providerId as AiProviderId,
    baseUrl: candidate.baseUrl,
    model: candidate.model,
  });
  if (!isIsoDate(candidate.createdAt) || !isIsoDate(candidate.updatedAt)) {
    throw new Error('Stored AI model profile timestamps are invalid.');
  }
  return {
    id: candidate.id,
    name: validated.name,
    providerId: validated.providerId,
    baseUrl: validated.baseUrl,
    model: validated.model,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}

function isIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}
