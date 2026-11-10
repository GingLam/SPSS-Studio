import assert from 'node:assert/strict';
import path from 'node:path';
import { analyzeCompletionContext } from '../../src/language/completionContext';
import { getCompletionCandidates } from '../../src/language/completionEngine';
import { COMMAND_TEMPLATES, renderSyntaxTemplate, usesChineseCompletionHints } from '../../src/language/completionTemplates';
import { loadLanguageSchema } from '../../src/language/languageSchema';
import { scanCommands } from '../../src/spss/commandScanner';
import type { ActiveDatasetInfo } from '../../src/spss/types';
import { VariableCache } from '../../src/spss/variableCache';

const schema = loadLanguageSchema(path.resolve(__dirname, '../../..'));

function labels(text: string): string[] {
  const context = analyzeCompletionContext(text, text.length, schema);
  return getCompletionCandidates(context, schema, []).map((item) => item.label);
}

describe('SPSS completion', () => {
  it('keeps automatic completion quiet on whitespace or in file arguments', () => {
    for (const text of ['', 'GET FILE ', 'COMPUTE x=income ', 'COMPUTE x=MEAN(']) {
      assert.deepEqual(labels(text), [], text);
    }
  });

  it('ranks GET FILE first for one letter and keeps the filename outside the inserted syntax', () => {
    const source = 'G';
    const item = getCompletionCandidates(analyzeCompletionContext(source, 1, schema), schema, [])[0];
    assert.equal(item?.label, 'GET FILE');
    assert.equal(item.insertText, 'GET FILE "$1".');
    assert.equal(item.snippet, true);
  });

  it('does not carry a completed command into the next empty line', () => {
    for (const ending of ['\n', '\r\n']) {
      for (const command of ['GET FILE "data.sav".', 'COMPUTE x=MEAN(1,2).', 'FREQUENCIES VARIABLES=age.']) {
        for (const suffix of ['', ending, ending + ending]) {
          assert.deepEqual(labels(command + suffix), [], command + suffix);
        }
      }
    }
  });

  it('offers command names without whole-command templates during ordinary typing', () => {
    assert.ok(labels('reg').includes('REGRESSION'));
    assert.ok(!labels('reg').includes('REGRESSION snippet'));
    assert.ok(labels('get fi').includes('GET FILE'));
  });

  it('recognizes multi-word command phrases across LF CRLF and tabs', () => {
    for (const text of ['REGRESSION\n /', 'REGRESSION\r\n /', 'REGRESSION\t/', 'GET\tDATA\r\n /', 'LOGISTIC\tREGRESSION\r\n /']) {
      const context = analyzeCompletionContext(text, text.length, schema);
      assert.equal(context.commandName, text.startsWith('GET') ? 'GET DATA' : text.startsWith('LOGISTIC') ? 'LOGISTIC REGRESSION' : 'REGRESSION');
    }
  });

  it('matches partial multi-word names with tabs or repeated spaces', () => {
    for (const text of ['GET\tDA', 'get  da', 'LOGISTIC\r\nREG']) {
      assert.ok(labels(text).includes(text.toUpperCase().startsWith('GET') ? 'GET DATA' : 'LOGISTIC REGRESSION'));
    }
  });

  it('keeps explicit completion available on a blank line and shows command variants during typing', () => {
    assert.equal(getCompletionCandidates(analyzeCompletionContext('', 0, schema), schema, [], 'manual')[0]?.label, 'GET FILE');
    assert.ok(labels('get d').includes('GET DATA · CSV'));
    assert.ok(labels('t').includes('T-TEST · Paired'));
    const pathContext = analyzeCompletionContext('GET FILE "reg', 13, schema);
    assert.deepEqual(getCompletionCandidates(pathContext, schema, [], 'manual'), []);
  });

  it('only offers verified subcommands belonging to the active command', () => {
    const regression = labels('REGRESSION\r\n /');
    assert.ok(regression.includes('/DEPENDENT'));
    assert.ok(!regression.includes('/CELLS'));
    assert.ok(!regression.includes('/DESTINATION'));
    assert.ok(labels('EXAMINE income BY gender\n /').includes('/PLOT'));
    assert.ok(labels('GET FILE "survey.sav" /').includes('/KEEP'));
    assert.ok(labels('GRAPH /').includes('/SCATTERPLOT'));
    assert.deepEqual(labels('/'), []);
  });

  it('preserves macro prefixes instead of offering unrelated ordinary commands', () => {
    assert.ok(labels('!IF').includes('!IF'));
    assert.ok(labels('DEFINE !sample().\n!L').includes('!LET'));
    assert.ok(!labels('!IF').includes('IF'));
    assert.ok(labels('!LE').includes('!LET'));
    assert.ok(!labels('!LE').includes('LEAVE'));
  });

  it('keeps dotted-function completion distinct from the command terminator', () => {
    assert.ok(labels('COMPUTE x=DATE.').includes('DATE.MDY'));
    assert.ok(labels('COMPUTE x=DATE.M').includes('DATE.MDY'));
    assert.deepEqual(labels('COMPUTE x=1.'), []);
  });

  it('uses only the current statement inside an unfinished control block', () => {
    const text = 'DO IF age>0.\r\n  COMPUTE x=DATE.M';
    assert.equal(analyzeCompletionContext(text, text.length, schema).commandName, 'COMPUTE');
    assert.ok(labels(text).includes('DATE.MDY'));
  });

  it('completes Chinese variable prefixes with their original spelling', () => {
    const text = 'DESCRIPTIVES VARIABLES=教';
    const candidates = getCompletionCandidates(analyzeCompletionContext(text, text.length, schema), schema, [
      { index: 0, name: '教育程度', label: 'Education', type: 'Numeric', format: 'F3.0', measurementLevel: 'scale' },
    ]);
    assert.equal(candidates[0]?.insertText, '教育程度');
  });

  it('retains variable-only completion for known commands without a dedicated argument map', () => {
    const text = 'SORT CASES BY ag';
    const candidates = getCompletionCandidates(analyzeCompletionContext(text, text.length, schema), schema, [
      { index: 0, name: 'age', label: '', type: 'Numeric', format: 'F3.0' },
    ]);
    assert.deepEqual(candidates.map((item) => item.label), ['age']);
  });

  it('keeps legal dotted variable names available without reopening a completed command', () => {
    const dotted = { index: 0, name: 'age.month', label: '', type: 'Numeric', format: 'F3.0' };
    const source = 'COMPUTE x=age.month';
    const offset = source.indexOf('.') + 1;
    assert.equal(getCompletionCandidates(analyzeCompletionContext(source, offset, schema), schema, [dotted])[0]?.label, 'age.month');
    const unfinished = 'DESCRIPTIVES VARIABLES=age.';
    const context = analyzeCompletionContext(unfinished, unfinished.length, schema);
    assert.equal(getCompletionCandidates(context, schema, [dotted])[0]?.label, 'age.month');
    const both = [dotted, { ...dotted, index: 1, name: 'age' }];
    assert.deepEqual(getCompletionCandidates(context, schema, both), []);
    assert.equal(getCompletionCandidates(context, schema, both, 'manual')[0]?.label, 'age.month');
  });

  it('does not let a later control-block closing line change the lexical context at the caret', () => {
    const source = 'DO IF age>0.\n* It\'s a note.\nCOMPUTE x=mean(age).\nEND IF.';
    const offset = source.indexOf('mean') + 3;
    const context = analyzeCompletionContext(source, offset, schema);
    assert.ok(getCompletionCandidates(context, schema, []).some((item) => item.label === 'MEAN'));
  });

  it('treats division in conditional control commands as an expression', () => {
    for (const head of ['ELSE IF', 'LOOP IF', 'END LOOP IF']) {
      const text = `${head} (age / in`;
      const context = analyzeCompletionContext(text, text.length, schema);
      const items = getCompletionCandidates(context, schema, [
        { index: 0, name: 'income', label: '', type: 'Numeric', format: 'F8.2' },
      ]);
      assert.ok(items.some((item) => item.label === 'income'), head);
      assert.ok(items.every((item) => item.kind !== 'subcommand'), head);
    }
  });

  it('preserves variable selection clauses in file commands without suggesting variables as filenames', () => {
    const variables = [{ index: 0, name: 'age', label: '', type: 'Numeric', format: 'F3.0' }];
    for (const command of ['SAVE OUTFILE="out.sav"', 'XSAVE OUTFILE="out.sav"', 'GET FILE "input.sav"']) {
      for (const option of ['KEEP', 'DROP']) {
        const text = `${command} /${option}=ag`;
        const items = getCompletionCandidates(analyzeCompletionContext(text, text.length, schema), schema, variables);
        assert.deepEqual(items.map((item) => item.label), ['age'], text);
      }
    }
    for (const text of ['GET FILE=ag', 'GET FILE ag', 'SAVE OUTFILE=ag', 'GET DATA /FILE=ag']) {
      const context = analyzeCompletionContext(text, text.length, schema);
      assert.deepEqual(getCompletionCandidates(context, schema, variables), [], text);
      assert.deepEqual(getCompletionCandidates(context, schema, variables, 'manual'), [], text);
    }
    const dotted = [{ index: 0, name: 'age.month', label: '', type: 'Numeric', format: 'F3.0' }];
    for (const text of ['GET FILE=age.', 'SAVE OUTFILE=age.', 'GET DATA /FILE=age.']) {
      const context = analyzeCompletionContext(text, text.length, schema);
      assert.deepEqual(getCompletionCandidates(context, schema, dotted), [], text);
      assert.deepEqual(getCompletionCandidates(context, schema, dotted, 'manual'), [], text);
    }
    const selection = 'SAVE OUTFILE="out.sav" /KEEP=age.';
    assert.equal(getCompletionCandidates(analyzeCompletionContext(selection, selection.length, schema), schema, dotted)[0]?.label, 'age.month');
  });

  it('completes single-word and multi-word commands by prefix', () => {
    assert.ok(labels('reg').includes('REGRESSION'));
    assert.ok(labels('freq').includes('FREQUENCIES'));
    assert.ok(labels('get d').includes('GET DATA'));
    assert.ok(labels('logistic r').includes('LOGISTIC REGRESSION'));
  });

  it('offers double-quoted string templates and omits the optional GET FILE equals sign', () => {
    const candidates = getCompletionCandidates(analyzeCompletionContext('', 0, schema), schema, [], 'manual');
    const expected = new Map([
      ['GET FILE', 'GET FILE "$1".'],
      ['GET DATA', 'GET DATA\n /TYPE=XLSX\n /FILE="$1".'],
      ['RELIABILITY', 'RELIABILITY\n /VARIABLES=$1.'],
    ]);
    for (const [label, insertText] of expected) {
      const candidate = candidates.find((item) => item.label === label);
      assert.ok(candidate, label);
      assert.equal(candidate.snippet, true);
      assert.equal(candidate.insertText, insertText);
    }
  });

  it('uses Chinese hints for Chinese interface variants and English for other interfaces', () => {
    assert.ok(['zh', 'zh-cn', 'zh-TW', 'zh-Hans'].every(usesChineseCompletionHints));
    assert.ok(['en', 'fr', 'ja', 'ko'].every((language) => !usesChineseCompletionHints(language)));
  });

  it('splits each subcommand and localizes all catalog placeholders without inserting them', () => {
    const source = 'GET DATA';
    const context = analyzeCompletionContext(source, source.length, schema);
    const csv = getCompletionCandidates(context, schema, [], 'automatic', true)
      .find((item) => item.label === 'GET DATA · CSV');
    assert.equal(csv?.template?.text, [
      'GET DATA', ' /TYPE=TXT', ' /FILE=""', ' /ARRANGEMENT=DELIMITED',
      ' /DELIMITERS=","', ' /VARIABLES=.',
    ].join('\n'));
    assert.deepEqual(csv.template.slots.map(({ hint }) => hint), ['数据.csv', '变量及格式']);
    for (const { id, pattern } of COMMAND_TEMPLATES) {
      const zh = renderSyntaxTemplate(pattern, true);
      const en = renderSyntaxTemplate(pattern, false);
      assert.equal(zh.text, en.text, id);
      assert.doesNotMatch(pattern, /[^\n] \/[A-Z{]/u, id);
      assert.ok(zh.slots.every(({ hint }) => /\p{Script=Han}/u.test(hint)), id);
      assert.ok(en.slots.every(({ hint }) => !/\p{Script=Han}/u.test(hint)), id);
    }
  });

  it('keeps path apostrophes, doubled double quotes, and Windows separators inside the completed string', () => {
    const candidate = getCompletionCandidates(analyzeCompletionContext('get', 3, schema), schema, [])
      .find((item) => item.label === 'GET FILE');
    assert.ok(candidate);
    for (const filePath of ["/data/O'Brien/study.sav", '/data/""quoted"" study.sav', String.raw`C:\data\O'Brien\study.sav`]) {
      const completed: string = candidate.insertText.replace('$1', () => filePath);
      assert.equal(completed, `GET FILE "${filePath}".`);
      const context = analyzeCompletionContext(completed, completed.length - 2, schema);
      assert.equal(context.kind, 'STRING');
      assert.deepEqual(getCompletionCandidates(context, schema, []), []);
      assert.deepEqual(scanCommands(`${completed}\nFREQUENCIES VARIABLES=age.`).map((command) => command.text), [
        completed, 'FREQUENCIES VARIABLES=age.',
      ]);
    }
  });

  it('retains completion suppression for handwritten single-quoted paths and optional equals', () => {
    for (const text of ["GET FILE='O''Brien/study.sav", "GET FILE 'data/\"quoted\" study.sav", 'GET FILE="O\'Brien/study.sav']) {
      const context = analyzeCompletionContext(text, text.length, schema);
      assert.equal(context.kind, 'STRING');
      assert.deepEqual(getCompletionCandidates(context, schema, []), []);
    }
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
    assert.equal(mean?.insertText, 'MEAN($1)');

    const date = getCompletionCandidates(
      analyzeCompletionContext('COMPUTE x=date.m', 16, schema),
      schema,
      [],
    ).find((item) => item.label === 'DATE.MDY');
    assert.equal(date?.insertText, 'DATE.MDY($1, $2, $3)');
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
