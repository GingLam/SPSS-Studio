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
          macros.has(command) ? 'macro' : controls.has(command) ? 'control' : 'command',
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
        (token) => token.type === 'macro' && token.content.toUpperCase() === directive,
      ), directive);
    }
    for (const variable of data.systemVariables) {
      assert.ok(tokenize(`COMPUTE x=${variable}.`).some(
        (token) => token.type === 'system-variable' && token.content.toUpperCase() === variable,
      ), variable);
    }
  });

  it('keeps raw embedded bodies plain and recognizes surrounding delimiters', () => {
    const tokens = tokenize('BEGIN DATA.\n1 2 3\nEND DATA.');
    assert.ok(tokens.some((token) => token.type === 'control' && token.content === 'BEGIN DATA'));
    assert.ok(tokens.some((token) => token.type === 'plain' && token.content.includes('1 2 3')));
    assert.ok(tokens.some((token) => token.type === 'control' && token.content === 'END DATA'));
  });
});
