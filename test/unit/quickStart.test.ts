import assert from 'node:assert/strict';
import { buildQuickStartHtml } from '../../src/quickStart/quickStartContent';
import {
  extensionVersion,
  isQuickStartMessage,
  quickStartLanguage,
  shouldShowQuickStart,
} from '../../src/quickStart/quickStartState';

describe('Quick Start', () => {
  it('selects Chinese for every Chinese UI locale and English otherwise', () => {
    assert.equal(quickStartLanguage('zh-cn'), 'zh-cn');
    assert.equal(quickStartLanguage('zh-TW'), 'zh-cn');
    assert.equal(quickStartLanguage('en'), 'en');
    assert.equal(quickStartLanguage('fr'), 'en');
  });

  it('shows on first installation and on later updates unless suppressed', () => {
    assert.equal(shouldShowQuickStart('1.1.0', {
      suppressAfterUpdates: false,
    }), true);
    assert.equal(shouldShowQuickStart('1.1.0', {
      suppressAfterUpdates: true,
    }), true);
    assert.equal(shouldShowQuickStart('1.1.0', {
      lastObservedVersion: '1.1.0',
      suppressAfterUpdates: false,
    }), false);
    assert.equal(shouldShowQuickStart('1.2.0', {
      lastObservedVersion: '1.1.0',
      suppressAfterUpdates: false,
    }), true);
    assert.equal(shouldShowQuickStart('1.2.0', {
      lastObservedVersion: '1.1.0',
      suppressAfterUpdates: true,
    }), false);
  });

  it('validates the package version and Webview preference messages', () => {
    assert.equal(extensionVersion({ version: '1.1.0' }), '1.1.0');
    assert.throws(() => extensionVersion({ version: '' }), /version is unavailable/u);
    assert.equal(isQuickStartMessage({ type: 'setSuppressAfterUpdates', value: true }), true);
    assert.equal(isQuickStartMessage({ type: 'setSuppressAfterUpdates', value: 'true' }), false);
    assert.equal(isQuickStartMessage({ type: 'unknown', value: true }), false);
  });

  it('renders complete localized guides with a prominent persisted checkbox', () => {
    const common = {
      styleUri: 'vscode-resource://quick-start.css',
      scriptUri: 'vscode-resource://quick-start.js',
      nonce: 'test-nonce',
      cspSource: 'vscode-webview:',
    };
    const english = buildQuickStartHtml({
      ...common,
      language: 'en',
      suppressAfterUpdates: false,
    });
    const chinese = buildQuickStartHtml({
      ...common,
      language: 'zh-cn',
      suppressAfterUpdates: true,
    });

    assert.match(english, /<h1>Quick Start<\/h1>/u);
    assert.match(english, /Do not show Quick Start automatically after future updates/u);
    assert.match(english, /Output[\s\S]*Data[\s\S]*Variables[\s\S]*Chat/u);
    assert.match(english, /id="suppress-after-updates" type="checkbox">/u);
    assert.match(chinese, /<h1>快速上手<\/h1>/u);
    assert.match(chinese, /此后版本更新时不再自动显示快速上手/u);
    assert.match(chinese, /id="suppress-after-updates" type="checkbox" checked>/u);
    assert.match(chinese, /至少准备一个 <code>\.sps<\/code> 文件/u);
    assert.match(chinese, /第一次执行时[\s\S]*SPSS Studio/u);
    assert.match(chinese, /default-src 'none'/u);
    assert.match(chinese, /script-src 'nonce-test-nonce'/u);
  });
});
