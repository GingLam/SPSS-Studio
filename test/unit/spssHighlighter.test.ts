import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

interface SyntaxToken {
  type: string;
  content: string;
}

interface SyntaxData {
  commands: string[];
  controlCommands: string[];
  subcommands: string[];
  functions: string[];
  formats: string[];
  macroDirectives: string[];
  systemVariables: string[];
  tokenFamilies: string[];
  palettes: Record<'light' | 'dark', Record<string, { foreground: string; fontStyle?: string }>>;
}

describe('Chat SPSS syntax highlighter', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const context = {
    window: {} as {
      SPSS_SYNTAX_DATA?: SyntaxData;
      createSpssTokenizer?: (data: SyntaxData) => (source: string) => SyntaxToken[];
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(projectRoot, 'media', 'spss-syntax-data.js'), 'utf8'),
    context,
  );
  vm.runInNewContext(
    fs.readFileSync(path.join(projectRoot, 'media', 'spss-highlighter.js'), 'utf8'),
    context,
  );
  const data = context.window.SPSS_SYNTAX_DATA;
  const factory = context.window.createSpssTokenizer;
  assert.ok(data && factory);
  const tokenize = factory(data);

  it('recognizes every canonical command from the editor language schema', () => {
    const controls = new Set(data.controlCommands);
    const macros = new Set(data.macroDirectives);
    for (const command of data.commands) {
      const first = tokenize(`${command}.`).find((token) => token.type !== 'plain');
      assert.ok(first, command);
      if (command === 'COMMENT') {
        assert.equal(first.type, 'comment', command);
        assert.equal(first.content, 'COMMENT.', command);
      } else {
        assert.equal(first.content, command, command);
        assert.equal(
          first.type,
          macros.has(command)
            ? 'macro-directive'
            : controls.has(command)
              ? 'command-control'
              : 'command',
          command,
        );
      }
    }
  });

  it('recognizes the shared subcommand, function, format, macro, and system vocabularies', () => {
    for (const subcommand of data.subcommands) {
      assert.ok(tokenize(`FREQUENCIES /${subcommand}=x.`).some(
        (token) => token.type === 'subcommand' && token.content.toUpperCase() === subcommand,
      ), subcommand);
    }
    for (const functionName of data.functions) {
      assert.ok(tokenize(`COMPUTE x=${functionName}(1).`).some(
        (token) => token.type === 'function' && token.content.toUpperCase() === functionName,
      ), functionName);
    }
    for (const format of data.formats) {
      assert.ok(tokenize(`FORMATS x (${format}8.2).`).some(
        (token) => token.type === 'format' && token.content.toUpperCase() === `${format}8.2`,
      ), format);
    }
    for (const directive of data.macroDirectives) {
      assert.ok(tokenize(`${directive} value.`).some(
        (token) => token.type === 'macro-directive' && token.content.toUpperCase() === directive,
      ), directive);
    }
    for (const variable of data.systemVariables) {
      assert.ok(tokenize(`COMPUTE x=${variable}.`).some(
        (token) => token.type === 'variable-system' && token.content.toUpperCase() === variable,
      ), variable);
    }
  });

  it('keeps raw embedded bodies plain and recognizes surrounding delimiters', () => {
    const tokens = tokenize('BEGIN DATA.\n1 2 3\nEND DATA.');
    assert.ok(tokens.some((token) => token.type === 'command-control' && token.content === 'BEGIN DATA'));
    assert.ok(tokens.some((token) => token.type === 'plain' && token.content.includes('1 2 3')));
    assert.ok(tokens.some((token) => token.type === 'command-control' && token.content === 'END DATA'));
  });

  it('distinguishes the complete editor token taxonomy', () => {
    const tokens = tokenize([
      'DO IF income >= 1000 AND NOT MISSING(income).',
      '  COMPUTE #delta = MEAN(income, 2) / 4.',
      '  RECODE income (SYSMIS=0).',
      'END IF.',
      'REGRESSION /DEPENDENT income /METHOD=ENTER education.',
      "FORMATS income(F8.2). TITLE 'Example'.",
      'COMPUTE flagged = $SYSMIS.',
      '!LET !target = income.',
      '/* note */',
    ].join('\n'));
    const observed = new Set(tokens.map((token) => token.type));
    for (const family of [
      'command-control',
      'command',
      'subcommand',
      'keyword',
      'function',
      'format',
      'variable',
      'variable-system',
      'variable-scratch',
      'variable-macro',
      'macro-directive',
      'string',
      'number',
      'constant-missing',
      'operator-arithmetic',
      'operator-relational',
      'operator-logical',
      'comment',
      'punctuation',
    ]) {
      assert.ok(observed.has(family), `Missing Chat token family ${family}`);
    }
  });

  it('does not classify arithmetic division as a slash subcommand', () => {
    const tokens = tokenize('COMPUTE ratio = income / household_size.');
    assert.ok(tokens.some((token) => token.type === 'operator-arithmetic' && token.content === '/'));
    assert.ok(tokens.some((token) => token.type === 'variable' && token.content === 'household_size'));
    assert.ok(!tokens.some(
      (token) => token.type === 'subcommand' && token.content.toUpperCase() === 'HOUSEHOLD_SIZE',
    ));
  });

  it('ships complete Light and Dark presentation for every token family', () => {
    assert.ok(data.tokenFamilies.length >= 19);
    for (const family of data.tokenFamilies) {
      assert.match(data.palettes.light[family]?.foreground ?? '', /^#[0-9A-F]{6}$/u, family);
      assert.match(data.palettes.dark[family]?.foreground ?? '', /^#[0-9A-F]{6}$/u, family);
    }
  });
});
