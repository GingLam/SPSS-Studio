import assert from 'node:assert/strict';
import {
  buildChatCompletionRequest,
  buildAssistantInstruction,
  boundConversation,
  SPSS_ASSISTANT_INSTRUCTION,
  type AiChatMessage,
} from '../../src/ai/chatProtocol';
import { buildSyntaxExplanationQuestion } from '../../src/ai/syntaxExplanation';
import { parseAssistantContent } from '../../src/ai/fencedCode';
import {
  AI_PROVIDER_PRESETS,
  buildChatCompletionsUrl,
  validateProviderConfiguration,
} from '../../src/ai/providerPresets';
import { OpenAiSseParser } from '../../src/ai/sseParser';

describe('AI provider presets and URL policy', () => {
  it('defines the four domestic providers and a custom option', () => {
    assert.deepEqual(AI_PROVIDER_PRESETS.map((preset) => preset.id), [
      'deepseek', 'zhipu', 'qwen', 'doubao', 'custom',
    ]);
    assert.equal(AI_PROVIDER_PRESETS[0]?.baseUrl, 'https://api.deepseek.com');
    assert.equal(AI_PROVIDER_PRESETS[2]?.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('builds Chat Completions endpoints without duplicating slashes', () => {
    assert.equal(
      buildChatCompletionsUrl('https://api.deepseek.com/'),
      'https://api.deepseek.com/chat/completions',
    );
    assert.equal(
      buildChatCompletionsUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'),
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
  });

  it('accepts HTTPS and loopback HTTP but rejects credentials and remote HTTP', () => {
    assert.doesNotThrow(() => validateProviderConfiguration({
      providerId: 'custom', baseUrl: 'https://models.example.com/v1', model: 'example-model',
    }));
    assert.doesNotThrow(() => validateProviderConfiguration({
      providerId: 'custom', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-model',
    }));
    assert.throws(() => validateProviderConfiguration({
      providerId: 'custom', baseUrl: 'http://models.example.com/v1', model: 'example-model',
    }), /HTTPS/u);
    assert.throws(() => validateProviderConfiguration({
      providerId: 'custom', baseUrl: 'https://user:secret@models.example.com/v1', model: 'example-model',
    }), /credentials/u);
  });
});

describe('AI conversation request boundaries', () => {
  it('anchors concise answers in SPSS Syntax and applied social statistics', () => {
    assert.match(SPSS_ASSISTANT_INSTRUCTION, /简体中文/u);
    assert.match(SPSS_ASSISTANT_INSTRUCTION, /默认回答简洁/u);
    assert.match(SPSS_ASSISTANT_INSTRUCTION, /spss/iu);
    assert.ok(SPSS_ASSISTANT_INSTRUCTION.length < 600);
    const english = buildAssistantInstruction('en');
    assert.match(english, /entirely in English/iu);
    assert.match(english, /concise/iu);
    assert.ok(english.length < 900);
  });

  it('wraps only the selected syntax in a minimal explanation request', () => {
    assert.equal(
      buildSyntaxExplanationQuestion('  FREQUENCIES VARIABLES=age.\n'),
      '请简要解释以下 SPSS Syntax：\n\n```spss\nFREQUENCIES VARIABLES=age.\n```',
    );
    assert.equal(
      buildSyntaxExplanationQuestion('FREQUENCIES VARIABLES=age.', 'en'),
      'Briefly explain this SPSS Syntax:\n\n```spss\nFREQUENCIES VARIABLES=age.\n```',
    );
    assert.throws(() => buildSyntaxExplanationQuestion('  \n '), /empty/iu);
  });

  it('builds a minimal streamed request containing only system and chat text', () => {
    const request = buildChatCompletionRequest('model-a', [
      { role: 'user', content: 'How do I run FREQUENCIES?' },
      { role: 'assistant', content: 'Use a fenced block.' },
    ]);
    assert.deepEqual(Object.keys(request).sort(), ['messages', 'model', 'stream']);
    assert.equal(request.stream, true);
    assert.equal(request.messages[0]?.role, 'system');
    assert.match(request.messages[0].content, /简体中文/u);
    assert.equal(request.messages[1]?.content, 'How do I run FREQUENCIES?');
    const serialized = JSON.stringify(request);
    for (const forbidden of ['file', 'selection', 'variables', 'dataset', 'output', 'workspace']) {
      assert.equal(serialized.includes(`"${forbidden}"`), false);
    }
  });

  it('uses the shared English response preference when requested', () => {
    const request = buildChatCompletionRequest('model-a', [
      { role: 'user', content: '解释 FREQUENCIES。' },
    ], 'en');
    assert.match(request.messages[0]?.content ?? '', /entirely in English/iu);
  });

  it('drops the oldest complete exchanges when history exceeds limits', () => {
    const history: AiChatMessage[] = [
      { role: 'user', content: 'u1' }, { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' }, { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' }, { role: 'assistant', content: 'a3' },
    ];
    assert.deepEqual(boundConversation(history, 4, 100), history.slice(2));
  });
});

describe('assistant fenced-code parsing', () => {
  it('separates prose and code without fence markers or the language identifier', () => {
    assert.deepEqual(
      parseAssistantContent('Try this:\n```spss\nFREQUENCIES VARIABLES=age.\n```\nThen inspect Output.'),
      [
        {
          type: 'markdown',
          blocks: [{ type: 'paragraph', children: [{ type: 'text', content: 'Try this:' }] }],
        },
        { type: 'code', language: 'spss', content: 'FREQUENCIES VARIABLES=age.\n' },
        {
          type: 'markdown',
          blocks: [{ type: 'paragraph', children: [{ type: 'text', content: 'Then inspect Output.' }] }],
        },
      ],
    );
  });

  it('treats an unclosed fence as inert text', () => {
    assert.deepEqual(parseAssistantContent('```spss\nFREQUENCIES.'), [
      {
        type: 'markdown',
        blocks: [{
          type: 'paragraph',
          children: [
            { type: 'text', content: '```spss' },
            { type: 'break' },
            { type: 'text', content: 'FREQUENCIES.' },
          ],
        }],
      },
    ]);
  });
});

describe('OpenAI-compatible SSE parser', () => {
  it('parses content across arbitrary chunks and ignores reasoning-only events', () => {
    const parser = new OpenAiSseParser();
    assert.deepEqual(parser.feed('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\nda'), []);
    assert.deepEqual(parser.feed('ta: {"choices":[{"delta":{"content":"FREQUENCIES"}}]}\r\n\r\n'), ['FREQUENCIES']);
    assert.deepEqual(parser.feed('data: {"choices":[{"delta":{"content":"."}}]}\n\ndata: [DONE]\n\n'), ['.']);
    assert.deepEqual(parser.finish(), []);
  });

  it('reports malformed JSON events', () => {
    const parser = new OpenAiSseParser();
    assert.throws(() => parser.feed('data: {bad json}\n\n'), /Malformed/u);
  });
});
