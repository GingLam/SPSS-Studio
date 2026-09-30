import assert from 'node:assert/strict';
import { findCurrentCommand, scanCommands } from '../../src/spss/commandScanner';

function commandAt(source: string, needle: string): string {
  const offset = source.indexOf(needle);
  assert.notEqual(offset, -1, `Needle not found: ${needle}`);
  const result = findCurrentCommand(source, offset);
  assert.equal(result.kind, 'found', result.kind === 'none' ? result.reason : undefined);
  return result.text;
}

describe('SPSS command scanner', () => {
  it('does not split decimals, formats, function modifiers, or dotted functions', () => {
    const cases = [
      'COMPUTE x = 1.25.',
      'COMPUTE x = .5.',
      'COMPUTE x = MEAN.3(a,b,c,d).',
      'FORMATS x(F8.2).',
      'COMPUTE x = DATE.MDY(1,2,2020).',
      'COMPUTE x = $SYSMIS.',
      'MISSING VALUES x (.).',
    ];
    for (const source of cases) {
      assert.equal(commandAt(source, 'x'), source);
    }
  });

  it('ignores periods inside strings and inline comments', () => {
    const title = 'TITLE "A sentence. With period.".';
    assert.equal(commandAt(title, 'sentence'), title);

    const inline = 'IF (x > .5) y = 1. /* comment . here */';
    assert.equal(commandAt(inline, 'y ='), inline);
  });

  it('returns the complete multiline command from every line', () => {
    const source = [
      'REGRESSION',
      ' /DEPENDENT y',
      ' /METHOD=ENTER x1 x2',
      ' /STATISTICS COEFF R ANOVA.',
    ].join('\n');
    for (const needle of ['REGRESSION', 'DEPENDENT', 'METHOD', 'STATISTICS']) {
      assert.equal(commandAt(source, needle), source);
    }
  });

  it('uses a blank line as a boundary for unterminated interactive commands', () => {
    const source = 'FREQUENCIES VARIABLES=x\n\nDESCRIPTIVES VARIABLES=x.';
    assert.equal(commandAt(source, 'FREQUENCIES'), 'FREQUENCIES VARIABLES=x');
    assert.equal(commandAt(source, 'DESCRIPTIVES'), 'DESCRIPTIVES VARIABLES=x.');
  });

  it('returns BEGIN DATA through END DATA as one block', () => {
    const source = [
      'DATA LIST FREE /x name(A20).',
      'BEGIN DATA',
      '1.25 "abc.def"',
      '2.50 "x"',
      'END DATA.',
      'DESCRIPTIVES VARIABLES=x.',
    ].join('\n');
    const expected = ['BEGIN DATA', '1.25 "abc.def"', '2.50 "x"', 'END DATA.'].join('\n');
    assert.equal(commandAt(source, 'abc.def'), expected);
    assert.equal(commandAt(source, 'END DATA'), expected);
  });

  it('returns structural program and control blocks as complete executable units', () => {
    const python = [
      'BEGIN PROGRAM PYTHON3.',
      'print("period. inside")',
      'END PROGRAM.',
    ].join('\n');
    assert.equal(commandAt(python, 'print'), python);

    const nested = [
      'DO IF x = 1.',
      '  LOOP #i = 1 TO 2.',
      '    COMPUTE y = y + #i.',
      '  END LOOP.',
      'ELSE.',
      '  COMPUTE y = 0.',
      'END IF.',
    ].join('\n');
    assert.equal(commandAt(nested, 'y +'), nested);
  });

  it('does not execute comments or unrelated commands from blank space', () => {
    const source = '* comment.\n\nFREQUENCIES VARIABLES=x.';
    const comment = findCurrentCommand(source, source.indexOf('comment'));
    assert.deepEqual(comment, { kind: 'none', reason: 'comment' });

    const blank = findCurrentCommand(source, source.indexOf('\n\n') + 1);
    assert.deepEqual(blank, { kind: 'none', reason: 'blank' });
  });

  it('preserves source text and reports stable ranges', () => {
    const source = '  COMPUTE x=1.\nFREQUENCIES VARIABLES=x.';
    const ranges = scanCommands(source);
    assert.equal(ranges.length, 2);
    const first = ranges[0];
    assert.ok(first);
    assert.equal(first.text, '  COMPUTE x=1.');
    assert.equal(source.slice(first.start, first.end), first.text);
  });
});
