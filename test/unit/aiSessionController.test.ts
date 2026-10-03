import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AiSessionController, type AiChatTransport } from '../../src/ai/aiSessionController';
import { ConversationStore } from '../../src/ai/conversationStore';
import { ModelProfileStore } from '../../src/ai/modelProfileStore';
import type { StreamChatOptions } from '../../src/ai/openAiCompatibleClient';
import type { KeyValueStore, SecretValueStore } from '../../src/ai/providerConfigurationStore';
import { exploreDisclaimer } from '../../src/ai/variableExplore';

class MemoryValues implements KeyValueStore {
  public readonly values = new Map<string, unknown>();
  public get(key: string): unknown { return this.values.get(key); }
  public update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

class MemorySecrets implements SecretValueStore {
  public readonly values = new Map<string, string>();
  public get(key: string): Promise<string | undefined> { return Promise.resolve(this.values.get(key)); }
  public store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
  public delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

class RecordingTransport implements AiChatTransport {
  public readonly requests: StreamChatOptions[] = [];
  public response = 'FREQUENCIES VARIABLES=age.';
  public pending: Promise<string> | undefined;

  public async streamChat(
    options: StreamChatOptions,
    onDelta: (delta: string) => void,
  ): Promise<string> {
    this.requests.push(options);
    if (this.pending) {
      return this.pending;
    }
    onDelta(this.response);
    return this.response;
  }
}

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{
  controller: AiSessionController;
  profiles: ModelProfileStore;
  transport: RecordingTransport;
}> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spss-ai-session-'));
  temporaryDirectories.push(directory);
  const values = new MemoryValues();
  const secrets = new MemorySecrets();
  let profileId = 0;
  let itemId = 0;
  let second = 0;
  const profiles = new ModelProfileStore(values, secrets, {
    createId: () => `profile-${String(++profileId)}`,
    now: () => new Date(Date.UTC(2026, 9, 1, 0, 0, second++)),
  });
  const transport = new RecordingTransport();
  return {
    profiles,
    transport,
    controller: new AiSessionController(
      profiles,
      new ConversationStore(directory),
      transport,
      {
        createId: () => `item-${String(++itemId)}`,
        now: () => new Date(Date.UTC(2026, 9, 1, 1, 0, second++)),
      },
    ),
  };
}

after(async () => {
  await Promise.all(temporaryDirectories.map(async (directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('AI session controller', () => {
  it('creates a persistent conversation with a local title and model snapshot', async () => {
    const { controller, profiles, transport } = await fixture();
    await profiles.create({
      name: 'Daily Syntax',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }, 'secret-key');
    const deltas: string[] = [];
    const result = await controller.sendQuestion('  How do I run frequencies?  ', {
      onDelta: (delta) => deltas.push(delta),
    });

    assert.deepEqual(deltas, [transport.response]);
    assert.ok(result.state.currentConversation);
    assert.equal(result.state.currentConversation.title, 'How do I run frequencies?');
    assert.equal(result.state.currentConversation.messages[1]?.profileName, 'Daily Syntax');
    assert.equal(JSON.stringify(result.state).includes('secret-key'), false);
    assert.equal(transport.requests[0]?.history.at(-1)?.content, 'How do I run frequencies?');
  });

  it('uses the historical model until a later profile selection changes future messages', async () => {
    const { controller, profiles, transport } = await fixture();
    const first = await profiles.create({
      name: 'DeepSeek',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }, 'deep-key');
    const second = await profiles.create({
      name: 'Qwen',
      providerId: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    }, 'qwen-key');
    await controller.selectProfile(first.id);
    await controller.sendQuestion('First question');
    const conversationId = (await controller.renderState()).currentConversation?.id;
    assert.ok(conversationId);

    await controller.newChat();
    await controller.openConversation(conversationId);
    assert.equal((await controller.renderState()).profiles.activeProfileId, first.id);
    await controller.selectProfile(second.id);
    await controller.sendQuestion('Second question');

    assert.equal(transport.requests[0]?.configuration.model, 'deepseek-chat');
    assert.equal(transport.requests[1]?.configuration.model, 'qwen-plus');
    const messages = (await controller.renderState()).currentConversation?.messages ?? [];
    assert.equal(messages[1]?.profileId, first.id);
    assert.equal(messages[3]?.profileId, second.id);
  });

  it('keeps history readable after its model profile is deleted', async () => {
    const { controller, profiles } = await fixture();
    const profile = await profiles.create({
      name: 'Temporary',
      providerId: 'doubao',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'ep-example',
    }, 'secret');
    await controller.sendQuestion('Keep this answer');
    await controller.deleteProfile(profile.id);
    const state = await controller.renderState();
    assert.equal(state.currentConversation?.messages[1]?.profileName, 'Temporary');
    await assert.rejects(controller.sendQuestion('Continue'), /Configure an AI model profile/u);
  });

  it('blocks state mutation during a request and preserves earlier history on failure', async () => {
    const { controller, profiles, transport } = await fixture();
    const profile = await profiles.create({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }, 'secret');
    let rejectRequest: ((error: Error) => void) | undefined;
    transport.pending = new Promise<string>((_resolve, reject) => {
      rejectRequest = reject;
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const sending = controller.sendQuestion('Pending question', { onStarted: () => markStarted?.() });
    await started;
    await assert.rejects(controller.selectProfile(profile.id), /Stop the current AI response/u);
    rejectRequest?.(new Error('network failed'));
    await assert.rejects(sending, /network failed/u);
    assert.equal((await controller.renderState()).history.length, 0);
  });

  it('keeps Explore follow-ups in context and appends one deterministic disclaimer', async () => {
    const { controller, profiles, transport } = await fixture();
    await profiles.create({
      name: 'Explore model',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }, 'secret-key');
    transport.response = '建议先运行 FREQUENCIES。';

    const first = await controller.sendQuestion(
      '## Variable Explore\n\n### education',
      {},
      'zh-CN',
      'variableExplore',
    );
    assert.equal(transport.requests[0]?.assistantContext, 'variableExplore');
    assert.equal(first.response.endsWith(exploreDisclaimer()), true);
    assert.equal(first.state.currentConversation?.context, 'variableExplore');
    const firstMessage = first.state.currentConversation.messages[0];
    assert.ok(firstMessage);
    assert.equal(firstMessage.questionKind, 'variableExplore');

    const followUp = await controller.sendQuestion('下一步如何绘图？');
    assert.equal(transport.requests[1]?.assistantContext, 'variableExplore');
    assert.equal(followUp.response.endsWith(exploreDisclaimer()), true);

    const syntax = await controller.sendQuestion('解释语法。', {}, 'zh-CN', 'syntaxExplain');
    assert.equal(transport.requests[2]?.assistantContext, 'standard');
    assert.equal(syntax.response.endsWith(exploreDisclaimer()), false);
    assert.equal(syntax.state.currentConversation?.context, 'standard');
  });
});
