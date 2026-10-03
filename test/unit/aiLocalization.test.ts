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

  it('uses one concise English label set for Chat navigation and model settings', () => {
    const expected = {
      activeProfile: 'Active model',
      configureModels: 'Setting',
      currentChat: 'Current',
      history: 'History',
      newChat: 'New',
      newProfile: 'New',
      name: 'Name',
      provider: 'Provider',
      responseLanguage: 'Language',
      enableReasoning: 'Reasoning',
      baseUrl: 'Base URL',
      model: 'Model',
      apiKey: 'API Key',
      save: 'Save',
      duplicate: 'Duplicate',
      makeActive: 'Activate',
      deleteKey: 'Delete key',
      delete: 'Delete',
      officialDocs: 'Docs',
      copy: 'Copy',
      insert: 'Insert',
      run: 'Run',
    };
    for (const strings of [AI_STRINGS_EN, AI_STRINGS_ZH_CN]) {
      const values = strings as unknown as Record<string, string>;
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(values[key], value, key);
      }
    }
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
