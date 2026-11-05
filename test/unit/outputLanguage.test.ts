import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nativeOutputLanguage } from '../../src/spss/outputLanguage';

describe('native SPSS output language policy', () => {
  it('maps all Chinese display languages to Simplified Chinese and other languages to English', () => {
    for (const language of ['zh', 'zh-cn', 'zh-tw', 'ZH-Hans', 'zh_CN']) {
      assert.equal(nativeOutputLanguage(language), 'Schinese');
    }
    for (const language of [undefined, '', 'en', 'en-us', 'de', 'ja', 'zhuang']) {
      assert.equal(nativeOutputLanguage(language), 'English');
    }
  });

  it('takes runtime language from VS Code instead of workspace or AI response settings', () => {
    const extension = fs.readFileSync(path.join(__dirname, '../../../src/extension.ts'), 'utf8');
    const configuration = extension.slice(extension.indexOf('function readConfiguration()'), extension.indexOf('export function activate('));
    assert.match(configuration, /uiLanguage:\s*vscode\.env\.language/u);
    assert.doesNotMatch(configuration, /responseLanguage|ai\.language|configuration\.get[^\n]*[Ll]anguage/u);
  });
});
