import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AI_STRINGS_EN,
  AI_STRINGS_ZH_CN,
  aiStringsForLanguage,
} from '../../src/ai/aiStrings';

describe('SPSS AI localization', () => {
  it('keeps identical Webview resource keys in English and Simplified Chinese', () => {
    assert.deepEqual(Object.keys(AI_STRINGS_ZH_CN).sort(), Object.keys(AI_STRINGS_EN).sort());
    assert.equal(aiStringsForLanguage('zh-cn'), AI_STRINGS_ZH_CN);
    assert.equal(aiStringsForLanguage('ZH-CN'), AI_STRINGS_ZH_CN);
    assert.equal(aiStringsForLanguage('fr'), AI_STRINGS_EN);
  });

  it('keeps package contribution localization keys in parity', () => {
    const root = path.resolve(__dirname, '../../..');
    const english = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;
    const chinese = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.zh-cn.json'), 'utf8')) as Record<string, string>;
    assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
    for (const value of Object.values({ ...english, ...chinese })) {
      assert.ok(value.trim());
    }
  });
});
