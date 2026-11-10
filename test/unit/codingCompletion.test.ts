import assert from 'node:assert/strict';
import path from 'node:path';
import { analyzeCodingDocument, declaredVariablesBefore, nextCommandContext, parseCodingChoice } from '../../src/language/codingCompletion';
import { loadLanguageSchema } from '../../src/language/languageSchema';

const schema = loadLanguageSchema(path.resolve(__dirname, '../../..'));
const context = (text: string) => nextCommandContext(text, text.length, analyzeCodingDocument(text, schema), true);

describe('SPSS next-command context', () => {
  it('builds the import sequence locally and preserves the same dataset name', () => {
    const cd = 'CD "D:\\private\\projects".\r\n';
    assert.equal(context(cd)?.local?.preview, 'GET FILE "SPSS数据名.sav".');
    assert.equal(context(cd)?.local?.text, 'GET FILE "".');
    const get = cd + 'GET FILE "D:\\private\\some data.sav".\r\n';
    assert.equal(context(get)?.local?.text, 'DATASET NAME some_data.');
    assert.equal(context(get + 'DATASET NAME some_data.\r\n')?.local?.text, 'DATASET ACTIVATE some_data.');
    assert.equal(context(get + 'DATASET NAME some_data.\r\nDATASET ACTIVATE some_data.\r\n')?.local, undefined);
  });

  it('omits paths, variables, comments, strings, and embedded bodies from remote payloads', () => {
    const source = [
      'GET FILE "D:\\private\\income-study.sav".',
      '* API key example-secret.',
      'VARIABLE LABELS sensitive_income "Private label".',
      'BEGIN PROGRAM PYTHON3.', 'print("secret inside Python")', 'END PROGRAM.',
      'DESCRIPTIVES sensitive_income.', '',
    ].join('\n');
    const result = context(source);
    assert.ok(result?.payload);
    assert.doesNotMatch(result.payload, /private|sensitive_income|secret|Python/iu);
    assert.match(result.payload, /DESCRIPTIVES/u);
    assert.match(result.payload, /"v1"/u);
    assert.equal(parseCodingChoice('{"template":"descriptives","bindings":{"variables":["v1"]}}', result, false)?.text,
      'DESCRIPTIVES sensitive_income.');
    assert.equal(parseCodingChoice('{"template":"descriptives","bindings":{"variables":["invented"]}}', result, false), undefined);
    assert.equal(parseCodingChoice('{"template":"delete-variables","bindings":{"variables":["v1"]}}', result, false), undefined);
  });

  it('preserves variable names beginning with an option word', () => {
    const result = context('DESCRIPTIVES variablescore.\n');
    assert.ok(result);
    assert.equal(parseCodingChoice('{"template":"descriptives","bindings":{"variables":["v1"]}}', result, false)?.text,
      'DESCRIPTIVES variablescore.');
  });

  it('discovers typed declarations without running the file', () => {
    const source = 'NUMERIC education (F4.0).\nSTRING ethnicity (A15).\nDESCRIPTIVES e';
    assert.deepEqual(declaredVariablesBefore(source, source.length, schema).map(({ name }) => name),
      ['education', 'ethnicity']);
  });

  it('keeps unfinished commands, empty file slots, comments, and opaque blocks quiet', () => {
    for (const source of [
      'CD "D:\\private"\n', 'GET FILE "".\n', 'GET FILE "data.sav".\n\n',
      'BEGIN DATA\n3.\n', 'BEGIN GPL.\nSOURCE: x.\n', 'MATRIX.\nCOMPUTE x=1.\n',
      '* comment.\n', 'COMPUTE x =.\n',
    ]) assert.equal(context(source), undefined, source);
  });
});
