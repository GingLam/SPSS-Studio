import {
  LEGACY_PROVIDER_CONFIGURATION_KEY,
  legacyProviderSecretKey,
  type KeyValueStore,
  type SecretValueStore,
} from './providerConfigurationStore';
import { validateProviderConfiguration, type AiProviderConfiguration } from './providerPresets';
import { MODEL_PROFILE_INDEX_KEY, profileSecretKey } from './modelProfile';
import type { ModelProfileStore } from './modelProfileStore';

export const MODEL_PROFILE_MIGRATION_KEY = 'spssStudio.ai.modelProfiles.migratedFromV1AndCleaned';

export type ModelProfileMigrationResult =
  | 'already-complete'
  | 'invalid-legacy-configuration'
  | 'migrated'
  | 'nothing-to-migrate';

export async function migrateLegacyProviderConfiguration(
  values: KeyValueStore,
  secrets: SecretValueStore,
  profiles: ModelProfileStore,
): Promise<ModelProfileMigrationResult> {
  if (values.get(MODEL_PROFILE_MIGRATION_KEY) === true) {
    return 'already-complete';
  }

  const legacyValue = values.get(LEGACY_PROVIDER_CONFIGURATION_KEY);
  if (legacyValue === undefined) {
    await values.update(MODEL_PROFILE_MIGRATION_KEY, true);
    return 'nothing-to-migrate';
  }
  const legacy = parseLegacyConfiguration(legacyValue);
  if (!legacy) {
    await values.update(MODEL_PROFILE_MIGRATION_KEY, true);
    return 'invalid-legacy-configuration';
  }

  const state = await profiles.state();
  let target = state.profiles.find((profile) => (
    profile.providerId === legacy.providerId
    && profile.baseUrl === legacy.baseUrl
    && profile.model === legacy.model
  ));
  if (!target) {
    const created = await profiles.create(legacy);
    target = { ...created, hasApiKey: false };
  }

  const oldKey = await secrets.get(legacyProviderSecretKey(legacy.providerId));
  const newSecretKey = profileSecretKey(target.id);
  if (oldKey) {
    const currentKey = await secrets.get(newSecretKey);
    if (!currentKey) {
      await secrets.store(newSecretKey, oldKey);
    } else if (currentKey !== oldKey) {
      throw new Error('The legacy AI key differs from the saved model-profile key.');
    }
  }

  const verifiedIndex = values.get(MODEL_PROFILE_INDEX_KEY);
  const verifiedState = await profiles.state();
  const verifiedProfile = verifiedState.profiles.find((profile) => profile.id === target.id);
  const verifiedSecret = oldKey ? await secrets.get(newSecretKey) : undefined;
  if (!verifiedIndex || !verifiedProfile || (oldKey && verifiedSecret !== oldKey)) {
    throw new Error('The legacy AI provider configuration could not be verified after migration.');
  }
  if (oldKey) {
    const legacySecret = legacyProviderSecretKey(legacy.providerId);
    await secrets.delete(legacySecret);
    if (await secrets.get(legacySecret)) {
      throw new Error('The verified legacy AI key could not be removed.');
    }
  }
  await values.update(MODEL_PROFILE_MIGRATION_KEY, true);
  return 'migrated';
}

function parseLegacyConfiguration(value: unknown): AiProviderConfiguration | undefined {
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
      providerId: candidate.providerId as AiProviderConfiguration['providerId'],
      baseUrl: candidate.baseUrl,
      model: candidate.model,
    });
  } catch {
    return undefined;
  }
}
