import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('SPSS language manifest and generated grammar', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'syntax', 'spss-language.json'), 'utf8'),
  ) as { commands: string[]; baseline: string };

  it('contains the complete canonical v25 command inventory', () => {
    assert.equal(manifest.baseline, 'IBM SPSS Statistics 25 Command Syntax');
    assert.equal(manifest.commands.length, 309);
    assert.equal(new Set(manifest.commands).size, manifest.commands.length);
    for (const command of [
      '2SLS',
      'BAYES ONESAMPLE POISSON',
      'CSCOXREG',
      'GENLINMIXED',
      'SPATIAL TEMPORAL PREDICTION',
      'T-TEST',
      'XSAVE',
    ]) {
      assert.ok(manifest.commands.includes(command), `Missing command: ${command}`);
    }
  });

  it('produces a valid TextMate grammar with required scopes', () => {
    const grammarText = fs.readFileSync(
      path.join(projectRoot, 'syntaxes', 'spss.tmLanguage.json'),
      'utf8',
    );
    const grammar = JSON.parse(grammarText) as { scopeName: string };
    assert.equal(grammar.scopeName, 'source.spss');
    for (const scope of [
      'keyword.control.spss',
      'keyword.other.command.spss',
      'keyword.other.subcommand.spss',
      'support.function.spss',
      'support.type.format.spss',
      'variable.other.scratch.spss',
      'variable.language.system.spss',
      'comment.line.command.spss',
      'meta.block.data.spss',
      'meta.block.program.spss',
    ]) {
      assert.match(grammarText, new RegExp(scope.replaceAll('.', '\\.')));
    }
  });

  it('generates documentation containing every canonical command', () => {
    const coverage = fs.readFileSync(
      path.join(projectRoot, 'docs', 'SYNTAX-COVERAGE.md'),
      'utf8',
    );
    for (const command of manifest.commands) {
      assert.match(coverage, new RegExp(`^${command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'mu'));
    }
  });

  it('generates Chat highlighting vocabulary from the same language manifest', () => {
    const context = { window: {} as { SPSS_SYNTAX_DATA?: Record<string, string[]> } };
    vm.runInNewContext(
      fs.readFileSync(path.join(projectRoot, 'media', 'spss-syntax-data.js'), 'utf8'),
      context,
    );
    const data = context.window.SPSS_SYNTAX_DATA;
    assert.ok(data);
    const fullManifest = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'syntax', 'spss-language.json'), 'utf8'),
    ) as Record<string, unknown>;
    for (const key of [
      'commands', 'controlCommands', 'subcommands', 'formats', 'macroDirectives',
      'reservedKeywords', 'structuralKeywords', 'systemVariables',
    ]) {
      assert.equal(
        JSON.stringify(data[key]),
        JSON.stringify(fullManifest[key]),
        `Chat vocabulary differs for ${key}`,
      );
    }
    assert.equal(
      JSON.stringify(data.completionKeywords),
      JSON.stringify((fullManifest.completion as { keywords: string[] }).keywords),
    );
    assert.ok(data.functions?.length && data.functions.length >= (fullManifest.functions as string[]).length);
  });

  it('uses valid language configuration without treating multiplication as a line comment', () => {
    const configuration = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'language-configuration.json'), 'utf8'),
    ) as {
      comments: { lineComment?: string; blockComment: string[] };
      folding: { markers: { start: string; end: string } };
    };
    assert.equal(configuration.comments.lineComment, undefined);
    assert.deepEqual(configuration.comments.blockComment, ['/*', '*/']);
    const start = new RegExp(configuration.folding.markers.start, 'u');
    const end = new RegExp(configuration.folding.markers.end, 'u');
    assert.match('Begin Program PYTHON3.', start);
    assert.match('End Program.', end);
  });
});
