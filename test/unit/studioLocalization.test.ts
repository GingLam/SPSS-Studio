import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  RUNTIME_STRINGS_EN,
  RUNTIME_STRINGS_ZH_CN,
  runtimeStringsForLanguage,
} from '../../src/localization/runtimeStrings';
import {
  providerPresetsForLanguage,
} from '../../src/ai/providerPresets';
import {
  STUDIO_STRINGS_EN,
  STUDIO_STRINGS_ZH_CN,
  studioStringsForLanguage,
} from '../../src/views/studioStrings';

describe('SPSS Studio interface localization', () => {
  it('keeps complete Studio and runtime catalogs in key parity', () => {
    assert.deepEqual(Object.keys(STUDIO_STRINGS_ZH_CN).sort(), Object.keys(STUDIO_STRINGS_EN).sort());
    assert.deepEqual(Object.keys(STUDIO_STRINGS_ZH_CN.engineStates).sort(), Object.keys(STUDIO_STRINGS_EN.engineStates).sort());
    assert.deepEqual(Object.keys(STUDIO_STRINGS_ZH_CN.executionStatuses).sort(), Object.keys(STUDIO_STRINGS_EN.executionStatuses).sort());
    assert.deepEqual(Object.keys(RUNTIME_STRINGS_ZH_CN).sort(), Object.keys(RUNTIME_STRINGS_EN).sort());
    assert.equal(studioStringsForLanguage('zh-cn'), STUDIO_STRINGS_ZH_CN);
    assert.equal(studioStringsForLanguage('ZH-CN'), STUDIO_STRINGS_ZH_CN);
    assert.equal(studioStringsForLanguage('zh-tw'), STUDIO_STRINGS_ZH_CN);
    assert.equal(runtimeStringsForLanguage('fr'), RUNTIME_STRINGS_EN);
  });

  it('uses the approved concise Chinese Studio terminology', () => {
    assert.deepEqual(
      [
        STUDIO_STRINGS_ZH_CN.tabVariables,
        STUDIO_STRINGS_ZH_CN.tabData,
        STUDIO_STRINGS_ZH_CN.tabOutput,
        STUDIO_STRINGS_ZH_CN.tabChat,
      ],
      ['变量', '数据', '输出', '对话'],
    );
    assert.equal(STUDIO_STRINGS_ZH_CN.measure, '测量层次');
    assert.equal(STUDIO_STRINGS_ZH_CN.exploring, '正在探索……');
    assert.equal(STUDIO_STRINGS_ZH_CN.filterNameOrLabel, '按名称或标签筛选');
  });

  it('localizes provider presentation without changing operational settings', () => {
    const english = providerPresetsForLanguage('en');
    const chinese = providerPresetsForLanguage('zh-cn');
    assert.deepEqual(chinese.map((preset) => preset.id), english.map((preset) => preset.id));
    assert.deepEqual(chinese.map((preset) => preset.baseUrl), english.map((preset) => preset.baseUrl));
    assert.deepEqual(chinese.map((preset) => preset.reasoningControl), english.map((preset) => preset.reasoningControl));
    assert.deepEqual(chinese.map((preset) => preset.label), [
      'DeepSeek', '智谱 GLM', '通义千问', '豆包', '自定义 OpenAI 兼容接口',
    ]);
  });

  it('localizes all contributed command titles through package NLS', () => {
    const root = path.resolve(__dirname, '../../..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      contributes: { commands: Array<{ command: string; title: string }> };
    };
    const english = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8')) as Record<string, string>;
    const chinese = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.zh-cn.json'), 'utf8')) as Record<string, string>;
    assert.equal(manifest.contributes.commands.length, 18);
    for (const command of manifest.contributes.commands) {
      assert.match(command.title, /^%spssStudio\.command\.[A-Za-z]+%$/u);
      const key = command.title.slice(1, -1);
      assert.ok(english[key]?.trim(), `Missing English command string: ${key}`);
      assert.ok(chinese[key]?.trim(), `Missing Chinese command string: ${key}`);
    }
  });
});
