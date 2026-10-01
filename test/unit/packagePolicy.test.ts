import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface PackagePolicyModule {
  assertAllowedSourceFiles(values: string[], phase?: string): string[];
  assertAllowedVsixEntries(values: string[]): string[];
  isAllowedSourceFile(value: string): boolean;
  normalizePackagePath(value: string): string;
}

async function loadPolicy(): Promise<PackagePolicyModule> {
  const modulePath = pathToFileURL(path.resolve(__dirname, '../../../tools/packagePolicy.mjs')).href;
  return import(modulePath) as Promise<PackagePolicyModule>;
}

describe('VSIX package policy', () => {
  it('allows only production extension files', async () => {
    const policy = await loadPolicy();
    const allowed = [
      'package.json',
      'README.md',
      'package.nls.zh-cn.json',
      'images/plugin.png',
      'media/ai.js',
      'out/src/extension.js',
      'out/src/ai/modelProfileStore.js',
      'resources/bridge/spss_bridge.py',
      'syntaxes/spss.tmLanguage.json',
    ];
    for (const value of allowed) {
      assert.equal(policy.isAllowedSourceFile(value), true, value);
    }
  });

  it('rejects development, history, secret, and traversal paths', async () => {
    const policy = await loadPolicy();
    const forbidden = [
      '.superpowers/brainstorm/layout.html',
      '.work/ai-history/history-v1.json',
      '.git/config',
      'src/extension.ts',
      'test/unit/aiUi.test.ts',
      'tools/package.mjs',
      'dist/spss-studio.vsix',
      'out/src/extension.js.map',
      'api-keys.json',
    ];
    for (const value of forbidden) {
      assert.equal(policy.isAllowedSourceFile(value), false, value);
    }
    assert.throws(() => policy.normalizePackagePath('../history.json'), /Unsafe package path/u);
  });

  it('validates both source listings and VSIX archive paths', async () => {
    const policy = await loadPolicy();
    const required = [
      'package.json',
      'out/src/extension.js',
      'resources/bridge/spss_bridge.py',
    ];
    assert.deepEqual(policy.assertAllowedSourceFiles(required), required);
    assert.deepEqual(policy.assertAllowedVsixEntries([
      '[Content_Types].xml',
      'extension.vsixmanifest',
      'extension/changelog.md',
      'extension/LICENSE.txt',
      'extension/readme.md',
      ...required.map((value) => `extension/${value}`),
    ]), ['CHANGELOG.md', 'LICENSE', 'README.md', ...required]);
    assert.throws(
      () => policy.assertAllowedVsixEntries([
        '[Content_Types].xml',
        'extension.vsixmanifest',
        ...required.map((value) => `extension/${value}`),
        'extension/.superpowers/layout.html',
      ]),
      /forbidden/u,
    );
  });
});
