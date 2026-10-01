import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('SPSS engine command UI behavior', () => {
  it('keeps diagnostics without automatically revealing the Output panel', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../src/commands/engineCommands.ts'),
      'utf8',
    );
    assert.doesNotMatch(source, /\.output\.show\(/u);
    assert.match(source, /\.output\.appendLine\(/u);
    assert.match(source, /showInformationMessage/u);
  });
});
