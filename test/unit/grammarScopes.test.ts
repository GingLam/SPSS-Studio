import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Registry, type IGrammar, type IRawGrammar, type IOnigLib, INITIAL } from 'vscode-textmate';
import { OnigScanner, OnigString, loadWASM } from 'vscode-oniguruma';

interface TokenView {
  text: string;
  scopes: string[];
}

async function loadGrammar(): Promise<IGrammar> {
  const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
  const wasm = fs.readFileSync(wasmPath);
  await loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const onigLib: Promise<IOnigLib> = Promise.resolve({
    createOnigScanner: (sources: string[]) => new OnigScanner(sources),
    createOnigString: (value: string) => new OnigString(value),
  });
  const projectRoot = path.resolve(__dirname, '../../..');
  const rawGrammar = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'syntaxes', 'spss.tmLanguage.json'), 'utf8'),
  ) as IRawGrammar;
  const registry = new Registry({
    onigLib,
    loadGrammar: (scopeName) => Promise.resolve(scopeName === 'source.spss' ? rawGrammar : null),
  });
  const grammar = await registry.loadGrammar('source.spss');
  assert.ok(grammar);
  return grammar;
}

function tokenizeLine(grammar: IGrammar, line: string): TokenView[] {
  return grammar.tokenizeLine(line, INITIAL).tokens.map((token) => ({
    text: line.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
}

function scopesFor(tokens: TokenView[], text: string): string[] {
  const token = tokens.find((candidate) => candidate.text.includes(text));
  assert.ok(token, `No token contains ${JSON.stringify(text)}.`);
  return token.scopes;
}

describe('generated TextMate grammar scopes', () => {
  let grammar: IGrammar;

  before(async () => {
    grammar = await loadGrammar();
  });

  it('distinguishes commands, subcommands, functions, formats, and numbers', () => {
    const command = tokenizeLine(grammar, 'REGRESSION');
    assert.ok(scopesFor(command, 'REGRESSION').includes('keyword.other.command.spss'));

    const subcommand = tokenizeLine(grammar, ' /DEPENDENT y');
    assert.ok(scopesFor(subcommand, 'DEPENDENT').includes('keyword.other.subcommand.spss'));

    const expression = tokenizeLine(grammar, 'COMPUTE x = MEAN.3(a, .5).');
    assert.ok(scopesFor(expression, 'MEAN.3').includes('support.function.spss'));
    assert.ok(scopesFor(expression, '.5').includes('constant.numeric.spss'));

    const format = tokenizeLine(grammar, 'FORMATS x(F8.2).');
    assert.ok(scopesFor(format, 'F8.2').includes('support.type.format.spss'));
  });

  it('does not turn multiplication or quoted content into comments or keywords', () => {
    const multiply = tokenizeLine(grammar, 'COMPUTE x = a * b.');
    assert.ok(scopesFor(multiply, '*').includes('keyword.operator.arithmetic.spss'));
    assert.ok(!scopesFor(multiply, '*').includes('comment.line.command.spss'));

    const quoted = tokenizeLine(grammar, `TITLE 'AND /* not a comment */ period.'.`);
    assert.ok(scopesFor(quoted, 'AND').includes('string.quoted.single.spss'));
    assert.ok(!scopesFor(quoted, 'AND').includes('keyword.operator.logical.spss'));
  });

  it('recognizes command comments and forward-compatible fallbacks', () => {
    const comment = tokenizeLine(grammar, '* comment with 1.25.');
    assert.ok(scopesFor(comment, 'comment').includes('comment.line.command.spss'));

    const unknownCommand = tokenizeLine(grammar, 'FUTURECOMMAND /FUTUREOPTION=YES.');
    assert.ok(scopesFor(unknownCommand, 'FUTURECOMMAND').includes('keyword.other.command.generic.spss'));
    assert.ok(scopesFor(unknownCommand, 'FUTUREOPTION').includes('keyword.other.subcommand.spss'));

    const unknownFunction = tokenizeLine(grammar, 'COMPUTE x = FUTURE.FUNC(a).');
    assert.ok(scopesFor(unknownFunction, 'FUTURE.FUNC').includes('support.function.spss'));
  });

  it('keeps BEGIN DATA content in the data block scope', () => {
    let state = INITIAL;
    const lines = ['BEGIN DATA', '1.25 "REGRESSION."', 'END DATA.'];
    const scopes: string[][] = [];
    for (const line of lines) {
      const result = grammar.tokenizeLine(line, state);
      state = result.ruleStack;
      scopes.push(result.tokens.flatMap((token) => token.scopes));
    }
    assert.ok(scopes[1]?.includes('meta.block.data.content.spss'));
    assert.ok(!scopes[1]?.includes('keyword.other.command.spss'));
  });

  it('tokenizes the complete all-features fixture without losing required scope families', () => {
    const projectRoot = path.resolve(__dirname, '../../..');
    const fixture = fs.readFileSync(
      path.join(projectRoot, 'test', 'fixtures', 'syntax', 'all-features.sps'),
      'utf8',
    );
    let state = INITIAL;
    const observed = new Set<string>();
    for (const line of fixture.split(/\r?\n/u)) {
      const result = grammar.tokenizeLine(line, state);
      state = result.ruleStack;
      for (const token of result.tokens) {
        for (const scope of token.scopes) {
          observed.add(scope);
        }
      }
    }
    for (const scope of [
      'keyword.other.command.spss',
      'keyword.other.command.generic.spss',
      'keyword.other.subcommand.spss',
      'keyword.operator.logical.spss',
      'keyword.operator.relational.spss',
      'support.function.spss',
      'support.type.format.spss',
      'variable.other.scratch.spss',
      'variable.language.system.spss',
      'variable.other.macro.spss',
      'variable.other.spss',
      'constant.numeric.spss',
      'constant.language.missing.spss',
      'string.quoted.single.spss',
      'string.quoted.double.spss',
      'comment.block.spss',
      'comment.line.command.spss',
      'keyword.control.macro.spss',
      'meta.block.data.spss',
      'meta.block.program.spss',
      'meta.block.matrix.spss',
      'meta.block.gpl.spss',
    ]) {
      assert.ok(observed.has(scope), `Fixture did not produce scope ${scope}`);
    }
  });
});
