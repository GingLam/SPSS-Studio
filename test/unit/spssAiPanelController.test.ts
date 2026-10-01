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
});

function createController(
  posted: ExtensionToAiWebviewMessage[],
  overrides: Partial<SpssAiPanelPlatform> = {},
): SpssAiPanelController {
  const session = {
    renderState: () => Promise.resolve({ busy: false, profiles: { profiles: [] }, history: [] }),
    stop: () => undefined,
    dispose: () => undefined,
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
  const uiState: KeyValueStore = {
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
