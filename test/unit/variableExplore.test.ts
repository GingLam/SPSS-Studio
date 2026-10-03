import assert from 'node:assert/strict';
import {
  appendExploreDisclaimer,
  buildVariableExploreQuestion,
  exploreDisclaimer,
  isOutOfScopeReply,
} from '../../src/ai/variableExplore';
import type { VariableProfiles } from '../../src/spss/types';

const fixture: VariableProfiles = {
  datasetName: 'survey',
  caseCount: 100,
  filterVariable: 'filter_$',
  profiles: [
    {
      index: 0,
      name: 'education',
      label: '教育程度',
      type: 'Numeric',
      format: 'F2.0',
      measurementLevel: 'Ordinal',
      valueLabels: [{ value: 1, label: '小学' }, { value: 2, label: '中学' }],
      valueLabelsTruncated: false,
      summary: {
        kind: 'categorical',
        validN: 98,
        missingN: 2,
        distinctCount: 2,
        approximate: false,
        topValues: [
          { value: 2, label: '中学', frequency: 60 },
          { value: 1, label: '小学', frequency: 38 },
        ],
      },
    },
  ],
};

describe('Variable Explore prompt', () => {
  it('formats bounded readable Markdown in the shared response language', () => {
    const chinese = buildVariableExploreQuestion(fixture);
    assert.match(chinese, /## Variable Explore/u);
    assert.match(chinese, /所选变量数: 1/u);
    assert.match(chinese, /### education/u);
    assert.match(chinese, /2 = 中学; N=60/u);
    assert.match(chinese, /筛选=filter_\$/u);
    assert.ok(chinese.length < 30_000);

    const english = buildVariableExploreQuestion(fixture, 'en');
    assert.match(english, /Selected variables: 1/u);
    assert.match(english, /Observed values/u);
  });

  it('appends exactly one localized responsibility statement as the final sentence', () => {
    const disclaimer = exploreDisclaimer();
    const result = appendExploreDisclaimer(`建议使用 FREQUENCIES。\n\n${disclaimer}`);
    assert.equal(result.split(disclaimer).length - 1, 1);
    assert.equal(result.endsWith(disclaimer), true);
    assert.equal(appendExploreDisclaimer('Use FREQUENCIES.', 'en').endsWith(exploreDisclaimer('en')), true);
  });

  it('recognizes fixed scope refusals', () => {
    assert.equal(isOutOfScopeReply(
      '该问题超出 SPSS Studio Chat 的支持范围。请提出与 SPSS Syntax、SPSS 应用或统计分析有关的问题。',
    ), true);
    assert.equal(isOutOfScopeReply('A statistical answer.'), false);
  });
});
