import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isAiWebviewMessage } from '../../src/views/aiWebviewProtocol';

describe('SPSS AI Webview contract', () => {
  it('accepts only bounded, well-formed user actions', () => {
    assert.equal(isAiWebviewMessage({ type: 'ready' }), true);
    assert.equal(isAiWebviewMessage({ type: 'sendQuestion', question: 'How do I use FREQUENCIES?' }), true);
    assert.equal(isAiWebviewMessage({ type: 'stop' }), true);
    assert.equal(isAiWebviewMessage({ type: 'newChat' }), true);
    assert.equal(isAiWebviewMessage({ type: 'clearAllConversations' }), true);
    assert.equal(isAiWebviewMessage({ type: 'openConversation', conversationId: 'conversation-1' }), true);
    assert.equal(isAiWebviewMessage({
      type: 'renameConversation',
      conversationId: 'conversation-1',
      title: 'Descriptive statistics',
    }), true);
    assert.equal(isAiWebviewMessage({ type: 'deleteConversation', conversationId: 'conversation-1' }), true);
    assert.equal(isAiWebviewMessage({ type: 'selectProfile', profileId: 'profile-1' }), true);
    assert.equal(isAiWebviewMessage({ type: 'insertCode', code: 'FREQUENCIES VARIABLES=age.' }), true);
    assert.equal(isAiWebviewMessage({ type: 'copyCode', code: 'FREQUENCIES VARIABLES=age.' }), true);
    assert.equal(isAiWebviewMessage({ type: 'openLink', url: 'https://www.ibm.com/docs/' }), true);
    assert.equal(isAiWebviewMessage({ type: 'openLink', url: 'javascript:alert(1)' }), false);
    assert.equal(isAiWebviewMessage({
      type: 'createProfile',
      name: 'DeepSeek teaching',
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-model',
      apiKey: '',
    }), true);
    assert.equal(isAiWebviewMessage({
      type: 'saveProfile',
      profileId: 'profile-1',
      name: '',
      providerId: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    }), true);
    assert.equal(isAiWebviewMessage({ type: 'setComposerHeight', height: 180 }), true);
    assert.equal(isAiWebviewMessage({ type: 'setResponseLanguage', language: 'zh-CN' }), true);
    assert.equal(isAiWebviewMessage({ type: 'setResponseLanguage', language: 'en' }), true);
    assert.equal(isAiWebviewMessage({ type: 'setResponseLanguage', language: 'fr' }), false);
    assert.equal(isAiWebviewMessage({ type: 'sendQuestion', question: '' }), false);
    assert.equal(isAiWebviewMessage({
      type: 'createProfile',
      providerId: 'unknown',
      baseUrl: 'https://example.com',
      model: 'model',
    }), false);
    assert.equal(isAiWebviewMessage({ type: 'setComposerHeight', height: 20 }), false);
    assert.equal(isAiWebviewMessage(Object.create({ type: 'ready' }) as unknown), false);
    assert.equal(isAiWebviewMessage({ type: 'executeCode', code: 'DELETE EVERYTHING' }), false);
  });

  it('uses inert DOM rendering and localized code actions inside a host-independent module', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.js'), 'utf8');
    const studioScript = fs.readFileSync(path.resolve(__dirname, '../../../media/studio.js'), 'utf8');
    assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(/u);
    assert.match(script, /textContent/u);
    assert.match(script, /strings\.insert/u);
    assert.match(script, /strings\.copy/u);
    assert.match(script, /window\.createSpssAiModule/u);
    assert.match(script, /return \{ handleMessage, resize, showPage \}/u);
    assert.doesNotMatch(script, /acquireVsCodeApi|window\.addEventListener\('message'/u);
    assert.equal(studioScript.match(/acquireVsCodeApi\(\)/gu)?.length, 1);
    assert.match(studioScript, /scope: 'shell', type: 'ready'/u);
    assert.match(script, /type: 'createProfile'/u);
    assert.match(script, /type: 'openConversation'/u);
    assert.match(script, /type: 'setComposerHeight'/u);
    assert.match(script, /type: 'setResponseLanguage'/u);
    assert.match(script, /function renderMarkdownBlocks/u);
    assert.match(script, /type: 'openLink'/u);
  });

  it('declares one restrictive Studio shell content security policy', () => {
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssStudioPanel.ts'),
      'utf8',
    );
    assert.match(panel, /default-src 'none'/u);
    assert.match(panel, /connect-src 'none'/u);
    assert.match(panel, /script-src 'nonce-\$\{nonce\}'/u);
    assert.doesNotMatch(panel, /script-src[^\n]*unsafe-inline/u);
  });

  it('keeps model profiles behind Manage Models and exposes an adjustable composer boundary', () => {
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssStudioPanel.ts'),
      'utf8',
    );
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.js'), 'utf8');
    const style = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.css'), 'utf8');
    assert.match(panel, /data-page="chat"/u);
    assert.match(panel, /data-page="history"/u);
    assert.doesNotMatch(panel, /data-page="profiles"/u);
    assert.match(panel, /id="manage-profiles"/u);
    assert.match(panel, /id="page-profiles"/u);
    assert.match(panel, /id="response-language"/u);
    assert.match(script, /manageProfiles\.addEventListener\('click', \(\) => showPage\('profiles'\)\)/u);
    assert.match(panel, /role="separator"/u);
    assert.match(panel, /aria-orientation="horizontal"/u);
    assert.match(script, /ArrowUp/u);
    assert.match(script, /ArrowDown/u);
    assert.match(script, /setPointerCapture/u);
    assert.match(style, /--composer-height/u);
    assert.match(style, /cursor: ns-resize/u);
  });

  it('distinguishes chat roles and highlights SPSS code without unsafe HTML rendering', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.js'), 'utf8');
    const style = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.css'), 'utf8');

    assert.match(script, /if \(role === 'assistant'\)/u);
    assert.doesNotMatch(script, /role === 'user'\s*\?\s*strings\.user/u);
    assert.match(script, /function renderSpssCode/u);
    assert.match(script, /window\.SPSS_SYNTAX_DATA/u);
    assert.doesNotMatch(script, /const SPSS_KEYWORDS/u);
    assert.match(script, /className = `syntax-token \$\{token\.type\}`/u);
    assert.match(script, /isSpssLanguage\(segment\.language\)/u);
    assert.match(style, /--vscode-inputOption-activeBackground/u);
    assert.match(style, /\.code-block[\s\S]*--vscode-editor-background/u);
    assert.match(style, /\.syntax-token\.keyword/u);
    assert.match(style, /\.syntax-token\.comment/u);
    assert.match(style, /\.code-actions button/u);
    assert.match(style, /--vscode-button-background/u);
  });

  it('keeps AI navigation in one compact header without redundant titles', () => {
    const panel = fs.readFileSync(
      path.resolve(__dirname, '../../../src/views/spssStudioPanel.ts'),
      'utf8',
    );
    const headerStart = panel.indexOf('<header class="ai-header">');
    const tabs = panel.indexOf('<nav id="tabs"');
    const headerEnd = panel.indexOf('</header>', headerStart);
    assert.ok(headerStart >= 0 && tabs > headerStart && tabs < headerEnd);
    assert.doesNotMatch(panel, /id="ai-title"/u);
    assert.doesNotMatch(panel, /id="transcript-title"/u);

    const style = fs.readFileSync(path.resolve(__dirname, '../../../media/ai.css'), 'utf8');
    assert.match(style, /grid-template-rows: auto auto minmax\(0, 1fr\)/u);
    assert.match(style, /grid-template-rows: minmax\(0, 1fr\) 9px var\(--composer-height\)/u);
  });
});
