import assert from 'node:assert/strict';
import path from 'node:path';
import { analyzeCompletionContext } from '../../src/language/completionContext';
import { getCompletionCandidates } from '../../src/language/completionEngine';
import { loadLanguageSchema } from '../../src/language/languageSchema';
import type { ActiveDatasetInfo } from '../../src/spss/types';
import { VariableCache } from '../../src/spss/variableCache';

const schema = loadLanguageSchema(path.resolve(__dirname, '../../..'));

function labels(text: string): string[] {
  const context = analyzeCompletionContext(text, text.length, schema);
  return getCompletionCandidates(context, schema, []).map((item) => item.label);
}

describe('SPSS completion', () => {
  it('completes single-word and multi-word commands by prefix', () => {
    assert.ok(labels('reg').includes('REGRESSION'));
    assert.ok(labels('freq').includes('FREQUENCIES'));
    assert.ok(labels('get d').includes('GET DATA'));
    assert.ok(labels('logistic r').includes('LOGISTIC REGRESSION'));
  });

  it('ranks command-specific subcommands before generic fallbacks', () => {
    const text = 'REGRESSION\n /dep';
    const context = analyzeCompletionContext(text, text.length, schema);
    assert.equal(context.kind, 'SUBCOMMAND');
    const candidates = getCompletionCandidates(context, schema, []);
    assert.equal(candidates[0]?.label, '/DEPENDENT');
  });

  it('offers verified function snippets in expressions', () => {
    const mean = getCompletionCandidates(
      analyzeCompletionContext('COMPUTE x=mea', 13, schema),
      schema,
      [],
    ).find((item) => item.label === 'MEAN');
    assert.equal(mean?.insertText, 'MEAN(${1:variables})');

    const date = getCompletionCandidates(
      analyzeCompletionContext('COMPUTE x=date.m', 16, schema),
      schema,
      [],
    ).find((item) => item.label === 'DATE.MDY');
    assert.equal(date?.insertText, 'DATE.MDY(${1:month}, ${2:day}, ${3:year})');
  });

  it('suppresses ordinary completion in strings, comments, data, and embedded programs', () => {
    const cases = [
      { text: 'TITLE "reg', expected: 'STRING' },
      { text: '* reg', expected: 'COMMENT' },
      { text: 'BEGIN DATA\nreg', expected: 'BEGIN_DATA' },
      { text: 'BEGIN PROGRAM PYTHON3.\nreg', expected: 'EMBEDDED_PROGRAM' },
    ] as const;
    for (const testCase of cases) {
      const context = analyzeCompletionContext(testCase.text, testCase.text.length, schema);
      assert.equal(context.kind, testCase.expected);
      assert.deepEqual(getCompletionCandidates(context, schema, []), []);
    }
  });

  it('uses only the in-memory variable cache and preserves dictionary case', () => {
    const cache = new VariableCache();
    const info: ActiveDatasetInfo = {
      active: true,
      datasetName: 'DataSet1',
      caseCount: 4,
      variableCount: 4,
      variables: [
        { index: 0, name: 'age', label: 'Age', type: 'Numeric', format: 'F8.0', measurementLevel: 'Scale' },
        { index: 1, name: 'age_group', label: '', type: 'Numeric', format: 'F1.0', measurementLevel: 'Nominal' },
        { index: 2, name: 'income', label: '', type: 'Numeric', format: 'F10.2', measurementLevel: 'Scale' },
        { index: 3, name: 'HouseholdIncome', label: 'Household income', type: 'Numeric', format: 'F10.2', measurementLevel: 'Scale' },
      ],
    };
    cache.replace(info);
    const ageContext = analyzeCompletionContext('DESCRIPTIVES VARIABLES=ag', 25, schema);
    const ageCandidates = getCompletionCandidates(ageContext, schema, cache.variables);
      assert.deepEqual(
        ageCandidates.filter((item) => item.kind === 'variable').map((item) => item.label),
        ['age', 'age_group'],
      );
    const householdContext = analyzeCompletionContext('DESCRIPTIVES VARIABLES=hou', 26, schema);
    const household = getCompletionCandidates(householdContext, schema, cache.variables)
      .find((item) => item.kind === 'variable');
    assert.equal(household?.insertText, 'HouseholdIncome');

    cache.clear();
    assert.deepEqual(cache.variables, []);
  });
});
