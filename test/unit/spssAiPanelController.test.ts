import assert from 'node:assert/strict';
import type { AiSessionController } from '../../src/ai/aiSessionController';
import type { KeyValueStore } from '../../src/ai/providerConfigurationStore';
import {
  SpssAiPanelController,
  type SpssAiPanelPlatform,
} from '../../src/views/spssAiPanelController';
import type { ExtensionToAiWebviewMessage } from '../../src/views/aiWebviewProtocol';

describe('embedded SPSS AI panel controller', () => {
  it('renders after the ready handshake and honors a pending internal page', async () => {
    const posted: ExtensionToAiWebviewMessage[] = [];
    const controller = createController(posted);
    await controller.showPage('profiles');
    assert.equal(posted.length, 0);

    await controller.handleMessage({ type: 'ready' });

    assert.equal(posted[0]?.type, 'renderState');
    assert.equal(posted[0].state.responseLanguage, 'zh-CN');
    assert.deepEqual(posted[1], { type: 'showPage', page: 'profiles' });
  });

  it('keeps code insertion and clipboard operations behind platform ports', async () => {
    const posted: ExtensionToAiWebviewMessage[] = [];
    const inserted: string[] = [];
    const copied: string[] = [];
    const controller = createController(posted, {
      insertCode: (code) => {
        inserted.push(code);
        return Promise.resolve(true);
      },
      writeClipboard: (code) => {
        copied.push(code);
        return Promise.resolve();
      },
    });

    await controller.handleMessage({ type: 'insertCode', code: 'FREQUENCIES VARIABLES=age.' });
    await controller.handleMessage({ type: 'copyCode', code: 'DESCRIPTIVES VARIABLES=age.' });

    assert.deepEqual(inserted, ['FREQUENCIES VARIABLES=age.']);
    assert.deepEqual(copied, ['DESCRIPTIVES VARIABLES=age.']);
  });

  it('queues an editor explanation until the embedded Chat webview is ready', async () => {
    const posted: ExtensionToAiWebviewMessage[] = [];
    const sent: string[] = [];
    const controller = createController(posted, {}, {
      renderState: () => Promise.resolve({
        busy: false,
        profiles: {
          activeProfileId: 'profile-1',
          profiles: [{
            id: 'profile-1',
            name: 'Test model',
            providerId: 'deepseek' as const,
            baseUrl: 'https://api.deepseek.com',
            model: 'deepseek-chat',
            reasoningEnabled: false,
            createdAt: '2026-10-02T00:00:00.000Z',
            updatedAt: '2026-10-02T00:00:00.000Z',
            hasApiKey: true,
          }],
        },
        history: [],
      }),
      sendQuestion: (question, callbacks) => {
        sent.push(question);
        callbacks?.onStarted?.(question);
        callbacks?.onDelta?.('Explanation');
        return Promise.resolve({
          response: 'Explanation',
          state: { busy: false, profiles: { profiles: [] }, history: [] },
        });
      },
    });

    await controller.sendQuestionFromEditor('Explain this SPSS Syntax.');
    assert.deepEqual(sent, []);
    await controller.handleMessage({ type: 'ready' });

    assert.deepEqual(sent, ['Explain this SPSS Syntax.']);
    assert.ok(posted.some((message) => message.type === 'responseStarted'));
    assert.ok(posted.some((message) => message.type === 'responseDelta'));
  });

  it('opens model management instead of sending when no usable profile exists', async () => {
    const posted: ExtensionToAiWebviewMessage[] = [];
    const warnings: string[] = [];
    const controller = createController(posted, {
      showWarning: (message) => warnings.push(message),
    });

    await controller.sendQuestionFromEditor('Explain this SPSS Syntax.');
    await controller.handleMessage({ type: 'ready' });

    assert.ok(warnings.some((message) => /model profile/iu.test(message)));
    assert.ok(posted.some((message) => message.type === 'showPage' && message.page === 'profiles'));
  });

  it('persists one shared response language and includes it in rendered state', async () => {
    const posted: ExtensionToAiWebviewMessage[] = [];
    const values = new Map<string, unknown>();
    const uiState: KeyValueStore = {
      get: (key) => values.get(key),
      update: (key, value) => {
        values.set(key, value);
        return Promise.resolve();
      },
    };
    const controller = createController(posted, {}, {}, uiState);
    await controller.handleMessage({ type: 'ready' });
    await controller.handleMessage({ type: 'setResponseLanguage', language: 'en' });

    assert.equal(controller.responseLanguage, 'en');
    const last = posted.at(-1);
    assert.equal(last?.type === 'renderState' ? last.state.responseLanguage : undefined, 'en');
  });
});

function createController(
  posted: ExtensionToAiWebviewMessage[],
  overrides: Partial<SpssAiPanelPlatform> = {},
  sessionOverrides: Partial<AiSessionController> = {},
  suppliedUiState?: KeyValueStore,
): SpssAiPanelController {
  const session = {
    renderState: () => Promise.resolve({ busy: false, profiles: { profiles: [] }, history: [] }),
    sendQuestion: () => Promise.reject(new Error('Unexpected send.')),
    stop: () => undefined,
    dispose: () => undefined,
    ...sessionOverrides,
  } as unknown as AiSessionController;
  const platform: SpssAiPanelPlatform = {
    insertCode: () => Promise.resolve(false),
    showWarning: () => undefined,
    writeClipboard: () => Promise.resolve(),
    openExternal: () => Promise.resolve(true),
    confirm: () => Promise.resolve(true),
    requireTrustedWorkspace: () => Promise.resolve(true),
    ...overrides,
  };
  const uiState: KeyValueStore = suppliedUiState ?? {
    get: () => undefined,
    update: () => Promise.resolve(),
  };
  const controller = new SpssAiPanelController(
    session,
    platform,
    uiState,
    Promise.resolve(),
    'en',
  );
  controller.attach((message) => {
    posted.push(message);
    return Promise.resolve(true);
  });
  return controller;
}
