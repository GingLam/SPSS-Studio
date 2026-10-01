import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CONVERSATION_SCHEMA_VERSION,
  type StoredConversation,
} from '../../src/ai/conversation';
import { ConversationStore } from '../../src/ai/conversationStore';
import { conversationTitleFromQuestion } from '../../src/ai/conversationTitle';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spss-ai-history-'));
  temporaryDirectories.push(directory);
  return directory;
}

function conversation(id: string, updatedSecond: number, content = `Question ${id}`): StoredConversation {
  const createdAt = new Date(Date.UTC(2026, 9, 1, 0, 0, updatedSecond)).toISOString();
  return {
    id,
    title: content,
    createdAt,
    updatedAt: createdAt,
    lastProfileId: 'profile-1',
    lastProfileName: 'Daily',
    messages: [
      { id: `${id}-u`, role: 'user', content, createdAt },
      {
        id: `${id}-a`,
        role: 'assistant',
        content: 'FREQUENCIES.',
        createdAt,
        profileId: 'profile-1',
        profileName: 'Daily',
        providerId: 'deepseek',
        model: 'deepseek-chat',
      },
    ],
  };
}

after(async () => {
  await Promise.all(temporaryDirectories.map(async (directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('AI conversation titles', () => {
  it('normalizes whitespace and truncates by Unicode characters without a model call', () => {
    assert.equal(conversationTitleFromQuestion('  如何做\n\n中介效应分析？  '), '如何做 中介效应分析？');
    assert.equal(conversationTitleFromQuestion('abcdef', 4), 'abcd…');
    assert.throws(() => conversationTitleFromQuestion('  '), /non-empty/u);
  });
});

describe('persistent AI conversation storage', () => {
  it('persists, sorts, reopens, renames, deletes, and clears conversations', async () => {
    const directory = await temporaryDirectory();
    const store = new ConversationStore(directory, {
      now: () => new Date(Date.UTC(2026, 9, 1, 0, 1, 0)),
    });
    await store.save(conversation('older', 1));
    await store.save(conversation('newer', 2));
    assert.deepEqual((await store.summaries()).map((item) => item.id), ['newer', 'older']);

    const restored = new ConversationStore(directory);
    assert.equal((await restored.state()).activeConversationId, 'newer');
    await restored.setActive('older');
    await restored.rename('older', '  Renamed   conversation ');
    assert.equal((await restored.get('older'))?.title, 'Renamed conversation');
    await restored.delete('newer');
    assert.equal((await restored.state()).conversations.length, 1);
    await restored.clear();
    assert.deepEqual(await restored.state(), {
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      conversations: [],
    });
  });

  it('keeps the newest 100 conversations and marks pruned conversations', async () => {
    const directory = await temporaryDirectory();
    const store = new ConversationStore(directory, {
      maxContentBytesPerConversation: 80,
      maxConversations: 100,
      maxMessagesPerConversation: 4,
      maxTotalBytes: 1_000_000,
    });
    for (let index = 0; index < 101; index += 1) {
      await store.save(conversation(`conversation-${String(index)}`, index));
    }
    const state = await store.state();
    assert.equal(state.conversations.length, 100);
    assert.equal(state.conversations.some((item) => item.id === 'conversation-0'), false);

    const long = conversation('long', 120);
    long.messages.push(
      { id: 'long-u2', role: 'user', content: 'Second question', createdAt: long.updatedAt },
      { id: 'long-a2', role: 'assistant', content: 'Second answer', createdAt: long.updatedAt },
      { id: 'long-u3', role: 'user', content: 'Third question', createdAt: long.updatedAt },
      { id: 'long-a3', role: 'assistant', content: 'Third answer', createdAt: long.updatedAt },
    );
    await store.save(long);
    const limited = await store.get('long');
    assert.ok(limited);
    assert.equal(limited.truncated, true);
    assert.ok(limited.messages.length <= 4);
    assert.equal(limited.messages[0]?.role, 'user');
  });

  it('restores a valid backup and preserves corrupt primary evidence', async () => {
    const directory = await temporaryDirectory();
    const warnings: string[] = [];
    const store = new ConversationStore(directory);
    await store.save(conversation('first', 1));
    await store.save(conversation('second', 2));
    await fs.writeFile(path.join(directory, 'history-v1.json'), '{broken', 'utf8');

    const restored = new ConversationStore(directory, { onWarning: (message) => warnings.push(message) });
    const state = await restored.state();
    assert.equal(state.conversations.some((item) => item.id === 'first'), true);
    assert.equal(state.conversations.some((item) => item.id === 'second'), false);
    assert.equal(warnings.length, 2);
    const files = await fs.readdir(directory);
    assert.equal(files.some((name) => name.includes('.corrupt-primary-')), true);
  });

  it('stores no API key or workspace path fields', async () => {
    const directory = await temporaryDirectory();
    const store = new ConversationStore(directory);
    await store.save(conversation('safe', 1));
    const serialized = await fs.readFile(path.join(directory, 'history-v1.json'), 'utf8');
    assert.doesNotMatch(serialized, /apiKey|workspace|filePath|secret-key/u);
  });
});
