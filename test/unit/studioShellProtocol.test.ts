import assert from 'node:assert/strict';
import { isStudioShellMessage } from '../../src/views/studioShellProtocol';

describe('unified Studio Webview protocol', () => {
  it('accepts only scoped shell, Studio, and AI messages', () => {
    assert.equal(isStudioShellMessage({ scope: 'shell', type: 'ready' }), true);
    assert.equal(isStudioShellMessage({ scope: 'studio', message: { type: 'showVariables' } }), true);
    assert.equal(isStudioShellMessage({
      scope: 'studio',
      message: { type: 'insertVariable', name: 'HouseholdIncome' },
    }), true);
    assert.equal(isStudioShellMessage({
      scope: 'ai',
      message: { type: 'sendQuestion', question: 'How do I run FREQUENCIES?' },
    }), true);
    assert.equal(isStudioShellMessage({ scope: 'unknown', message: { type: 'showVariables' } }), false);
    assert.equal(isStudioShellMessage({ scope: 'studio', message: { type: 'insertVariable', name: '' } }), false);
    assert.equal(isStudioShellMessage({ scope: 'studio', message: { type: 'arbitraryCommand' } }), false);
    assert.equal(isStudioShellMessage(Object.create({ scope: 'shell', type: 'ready' }) as unknown), false);
    assert.equal(isStudioShellMessage({ scope: 'ai' }), false);
  });
});
