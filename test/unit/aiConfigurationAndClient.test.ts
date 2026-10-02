import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAiCompatibleClient } from '../../src/ai/openAiCompatibleClient';
import { providerReasoningFields } from '../../src/ai/providerPresets';
import {
  ProviderConfigurationStore,
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

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('AI provider configuration storage', () => {
  it('keeps API keys only in the secret store and preserves an existing key', async () => {
    const values = new MemoryValues();
    const secrets = new MemorySecrets();
    const store = new ProviderConfigurationStore(values, secrets);
    const configuration = {
      providerId: 'deepseek' as const,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-model',
    };

    await store.save(configuration, 'secret-key');
    await store.save({ ...configuration, model: 'new-model' });
    const resolved = await store.resolve();

    assert.equal(resolved.apiKey, 'secret-key');
    assert.equal(resolved.configuration.model, 'new-model');
    assert.equal(JSON.stringify([...values.values.values()]).includes('secret-key'), false);
    assert.equal((await store.state()).hasApiKey, true);
    await store.deleteApiKey('deepseek');
    await assert.rejects(store.resolve(), /API Key/u);
  });
});

describe('OpenAI-compatible HTTP client', () => {
  it('sends only the configured chat request and parses a chunked stream', async () => {
    let capturedAuthorization = '';
    let capturedBody = '';
    const server = http.createServer((request, response) => {
      capturedAuthorization = request.headers.authorization ?? '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        capturedBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: {"choices":[{"delta":{"content":"FREQUEN"}}]}\n\n');
        response.end('data: {"choices":[{"delta":{"content":"CIES."}}]}\n\ndata: [DONE]\n\n');
      });
    });
    const port = await listen(server);
    try {
      const deltas: string[] = [];
      const result = await new OpenAiCompatibleClient().streamChat({
        configuration: {
          providerId: 'custom',
          baseUrl: `http://127.0.0.1:${String(port)}/v1`,
          model: 'local-model',
        },
        apiKey: 'test-secret',
        history: [{ role: 'user', content: 'Write syntax.' }],
        timeoutMs: 2_000,
      }, (delta) => {
        deltas.push(delta);
      });
      assert.equal(result, 'FREQUENCIES.');
      assert.deepEqual(deltas, ['FREQUEN', 'CIES.']);
      assert.equal(capturedAuthorization, 'Bearer test-secret');
      const body = JSON.parse(capturedBody) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'stream']);
    } finally {
      await close(server);
    }
  });

  it('does not follow redirects with the bearer credential', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(302, { Location: 'https://example.com/' });
      response.end();
    });
    const port = await listen(server);
    try {
      await assert.rejects(new OpenAiCompatibleClient().streamChat({
        configuration: {
          providerId: 'custom',
          baseUrl: `http://127.0.0.1:${String(port)}/v1`,
          model: 'local-model',
        },
        apiKey: 'test-secret',
        history: [{ role: 'user', content: 'Hello' }],
        timeoutMs: 2_000,
      }, () => undefined), /redirect/u);
    } finally {
      await close(server);
    }
  });

  it('adds the selected built-in provider reasoning field to the HTTP body', async () => {
    let capturedBody = '';
    const server = http.createServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        capturedBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
      });
    });
    const port = await listen(server);
    try {
      await new OpenAiCompatibleClient().streamChat({
        configuration: {
          providerId: 'deepseek',
          baseUrl: `http://127.0.0.1:${String(port)}/v1`,
          model: 'deepseek-chat',
        },
        apiKey: 'test-secret',
        history: [{ role: 'user', content: 'Explain FREQUENCIES.' }],
        reasoningEnabled: true,
        timeoutMs: 2_000,
      }, () => undefined);
      const body = JSON.parse(capturedBody) as Record<string, unknown>;
      assert.deepEqual(body.thinking, { type: 'enabled' });
    } finally {
      await close(server);
    }
  });

  it('maps reasoning only through documented provider-native request fields', () => {
    assert.deepEqual(providerReasoningFields('deepseek', false), {
      thinking: { type: 'disabled' },
    });
    assert.deepEqual(providerReasoningFields('deepseek', true), {
      thinking: { type: 'enabled' },
    });
    assert.deepEqual(providerReasoningFields('zhipu', false), {
      thinking: { type: 'disabled' },
    });
    assert.deepEqual(providerReasoningFields('qwen', false), {
      enable_thinking: false,
    });
    assert.deepEqual(providerReasoningFields('qwen', true), {
      enable_thinking: true,
    });
    assert.deepEqual(providerReasoningFields('doubao', true), {
      thinking: { type: 'enabled' },
    });
    assert.deepEqual(providerReasoningFields('custom', true), {});
    assert.deepEqual(providerReasoningFields('custom', false), {});
  });
});
