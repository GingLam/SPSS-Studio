import assert from 'node:assert/strict';
import {
  MODEL_PROFILE_INDEX_KEY,
  profileSecretKey,
} from '../../src/ai/modelProfile';
import {
  migrateLegacyProviderConfiguration,
  MODEL_PROFILE_MIGRATION_KEY,
} from '../../src/ai/modelProfileMigration';
import { ModelProfileStore } from '../../src/ai/modelProfileStore';
import {
  LEGACY_PROVIDER_CONFIGURATION_KEY,
  legacyProviderSecretKey,
  type KeyValueStore,
  type SecretValueStore,
} from '../../src/ai/providerConfigurationStore';

class MemoryValues implements KeyValueStore {
  public readonly values = new Map<string, unknown>();

  public get(key: string): unknown {
    return this.values.get(key);
  }

  public update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

class MemorySecrets implements SecretValueStore {
  public readonly values = new Map<string, string>();

  public get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  public store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  public delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

function createStore(): {
  store: ModelProfileStore;
  values: MemoryValues;
  secrets: MemorySecrets;
} {
  const values = new MemoryValues();
  const secrets = new MemorySecrets();
  const ids = ['profile-1', 'profile-2', 'profile-3'][Symbol.iterator]();
  let second = 0;
  return {
    store: new ModelProfileStore(values, secrets, {
      createId: () => ids.next().value ?? 'profile-fallback',
      now: () => new Date(Date.UTC(2026, 9, 1, 0, 0, second++)),
    }),
    values,
    secrets,
  };
}

describe('AI model profile storage', () => {
  it('creates an automatically named active profile without exposing its key', async () => {
    const { store, values } = createStore();
    const profile = await store.create({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }, 'secret-one');
    const state = await store.state();

    assert.equal(profile.name, 'DeepSeek · deepseek-chat');
    assert.equal(profile.reasoningEnabled, false);
    assert.equal(state.activeProfileId, profile.id);
    assert.equal(state.profiles[0]?.hasApiKey, true);
    assert.equal(JSON.stringify(values.values.get(MODEL_PROFILE_INDEX_KEY)).includes('secret-one'), false);
    assert.equal(JSON.stringify(state).includes('secret-one'), false);
  });

  it('keeps multiple profiles and secrets independent for one provider', async () => {
    const { store, secrets } = createStore();
    const first = await store.create({
      name: 'Daily',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }, 'key-one');
    const second = await store.create({
      name: 'Reasoning',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-reasoner',
    }, 'key-two');

    assert.equal((await store.resolve(first.id)).apiKey, 'key-one');
    assert.equal((await store.resolve(second.id)).apiKey, 'key-two');
    assert.equal(secrets.values.get(profileSecretKey(first.id)), 'key-one');
    assert.equal(secrets.values.get(profileSecretKey(second.id)), 'key-two');
  });

  it('updates, selects, duplicates, and deletes profiles predictably', async () => {
    const { store, secrets } = createStore();
    const first = await store.create({
      name: 'Daily',
      providerId: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    }, 'qwen-key');
    const updated = await store.update(first.id, {
      name: 'Complex Analysis',
      providerId: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-max',
      reasoningEnabled: true,
    });
    const copy = await store.duplicate(first.id);
    await store.select(copy.id);

    assert.equal(updated.name, 'Complex Analysis');
    assert.equal(updated.reasoningEnabled, true);
    assert.equal(copy.reasoningEnabled, true);
    assert.equal(copy.name, 'Complex Analysis (2)');
    assert.equal(await secrets.get(profileSecretKey(copy.id)), 'qwen-key');
    assert.equal((await store.state()).activeProfileId, copy.id);

    await store.delete(copy.id);
    const state = await store.state();
    assert.equal(state.activeProfileId, first.id);
    assert.equal(state.profiles.length, 1);
    assert.equal(await secrets.get(profileSecretKey(copy.id)), undefined);
  });

  it('preserves an existing key when a blank replacement is saved', async () => {
    const { store } = createStore();
    const profile = await store.create({
      providerId: 'doubao',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'ep-example',
    }, 'doubao-key');
    await store.update(profile.id, {
      name: 'Doubao',
      providerId: 'doubao',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'ep-updated',
    }, '   ');

    assert.equal((await store.resolve(profile.id)).apiKey, 'doubao-key');
    await store.deleteApiKey(profile.id);
    await assert.rejects(store.resolve(profile.id), /Doubao/u);
  });

  it('rejects invalid stored indexes instead of presenting an empty form', async () => {
    const { store, values } = createStore();
    values.values.set(MODEL_PROFILE_INDEX_KEY, { schemaVersion: 2, profiles: [{ id: '../secret' }] });
    await assert.rejects(store.state(), /invalid|incomplete/iu);
  });

  it('migrates schema v2 profiles with reasoning disabled and preserves their identity', async () => {
    const { store, values, secrets } = createStore();
    values.values.set(MODEL_PROFILE_INDEX_KEY, {
      schemaVersion: 2,
      activeProfileId: 'legacy-profile',
      profiles: [{
        id: 'legacy-profile',
        name: 'Existing DeepSeek',
        providerId: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      }],
    });
    secrets.values.set(profileSecretKey('legacy-profile'), 'existing-key');

    const state = await store.state();
    assert.equal(state.activeProfileId, 'legacy-profile');
    assert.equal(state.profiles[0]?.reasoningEnabled, false);
    assert.equal((await store.resolve()).apiKey, 'existing-key');
    assert.equal(
      (values.values.get(MODEL_PROFILE_INDEX_KEY) as { schemaVersion: number }).schemaVersion,
      3,
    );
  });
});

describe('legacy AI provider migration', () => {
  it('copies the 0.4.0 configuration and secret exactly once', async () => {
    const { store, values, secrets } = createStore();
    values.values.set(LEGACY_PROVIDER_CONFIGURATION_KEY, {
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
    secrets.values.set(legacyProviderSecretKey('deepseek'), 'legacy-key');

    assert.equal(await migrateLegacyProviderConfiguration(values, secrets, store), 'migrated');
    assert.equal(await migrateLegacyProviderConfiguration(values, secrets, store), 'already-complete');
    const state = await store.state();
    assert.equal(state.profiles.length, 1);
    assert.equal((await store.resolve(state.profiles[0]?.id)).apiKey, 'legacy-key');
    assert.equal(values.values.get(MODEL_PROFILE_MIGRATION_KEY), true);
    assert.equal(await secrets.get(legacyProviderSecretKey('deepseek')), undefined);
  });

  it('marks missing or invalid legacy state without creating a profile', async () => {
    const missing = createStore();
    assert.equal(
      await migrateLegacyProviderConfiguration(missing.values, missing.secrets, missing.store),
      'nothing-to-migrate',
    );
    assert.equal((await missing.store.state()).profiles.length, 0);

    const invalid = createStore();
    invalid.values.values.set(LEGACY_PROVIDER_CONFIGURATION_KEY, { providerId: 'unknown' });
    assert.equal(
      await migrateLegacyProviderConfiguration(invalid.values, invalid.secrets, invalid.store),
      'invalid-legacy-configuration',
    );
    assert.equal((await invalid.store.state()).profiles.length, 0);
  });

  it('reuses a partially created profile when secret migration is retried', async () => {
    const { store, values, secrets } = createStore();
    values.values.set(LEGACY_PROVIDER_CONFIGURATION_KEY, {
      providerId: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    });
    secrets.values.set(legacyProviderSecretKey('qwen'), 'qwen-key');
    const originalStore = secrets.store.bind(secrets);
    let shouldFail = true;
    secrets.store = (key: string, value: string): Promise<void> => {
      if (shouldFail && key.startsWith('spssStudio.ai.profile.')) {
        shouldFail = false;
        return Promise.reject(new Error('secret storage unavailable'));
      }
      return originalStore(key, value);
    };

    await assert.rejects(
      migrateLegacyProviderConfiguration(values, secrets, store),
      /secret storage unavailable/u,
    );
    assert.equal(values.values.get(MODEL_PROFILE_MIGRATION_KEY), undefined);
    assert.equal((await store.state()).profiles.length, 1);

    assert.equal(await migrateLegacyProviderConfiguration(values, secrets, store), 'migrated');
    assert.equal((await store.state()).profiles.length, 1);
    assert.equal(await secrets.get(legacyProviderSecretKey('qwen')), undefined);
  });
});
