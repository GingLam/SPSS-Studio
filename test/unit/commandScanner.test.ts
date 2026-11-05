import assert from 'node:assert/strict';
import { findCurrentCommand, lexicalRegionAt, scanCommands } from '../../src/spss/commandScanner';

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

  it('retains trailing inline comments without swallowing a following command or block end', () => {
    for (const comment of ['/* explanatory note */', '/* explanatory note']) {
      for (const ending of ['\n', '\r\n', 'mixed']) {
        const command = `COMPUTE y=1. ${comment}`;
        const lines = ['DO IF x=1.', command, 'END IF.', 'EXECUTE.'];
        const source = lines.map((line, index) => line + (index === lines.length - 1 ? ''
          : ending === 'mixed' ? index % 2 ? '\r\n' : '\n' : ending)).join('');
        assert.equal(commandAt(source, 'y=1'), source.slice(0, source.indexOf('END IF.') + 'END IF.'.length));
        assert.equal(commandAt(`${command}\r\n\r\nEXECUTE.`, 'y=1'), command);
        assert.equal(commandAt(`${command}\r\n\r\nEXECUTE.`, 'EXECUTE'), 'EXECUTE.');
      }
    }
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

  it('does not invent a terminator for syntax missing its command period', () => {
    const source = 'FREQUENCIES VARIABLES=x\n\nDESCRIPTIVES VARIABLES=x.';
    assert.equal(commandAt(source, 'FREQUENCIES'), source);
    assert.equal(commandAt(source, 'DESCRIPTIVES'), source);
  });

  it('preserves internal blank lines and separates only complete commands for every line ending', () => {
    for (const ending of ['\n', '\r\n', 'mixed']) {
      const lines = [
        '* user\'s note.', '',
        'RECODE I2_1 (1=0) (2=6)', '',
        '  (3=9) (4 THRU 7=12)', '  INTO edu_year.', '',
        'COMPUTE x=', '   ', '  1.', '',
        'REGRESSION', '', '  /DEPENDENT y', '  /METHOD=ENTER x.', '',
        'EXECUTE.',
      ];
      const source = lines.map((line, index) => line + (index === lines.length - 1 ? ''
        : ending === 'mixed' ? index % 2 ? '\r\n' : '\n' : ending)).join('');
      const ranges = scanCommands(source);
      assert.deepEqual(ranges.map((range) => range.type), ['comment', 'command', 'command', 'command', 'command']);
      for (const [needle, start, end] of [
        ['THRU', 'RECODE', 'INTO edu_year.'],
        ['1.', 'COMPUTE', '  1.'],
        ['METHOD', 'REGRESSION', '/METHOD=ENTER x.'],
      ]) {
        assert.ok(needle && start && end);
        assert.equal(commandAt(source, needle), source.slice(source.indexOf(start), source.indexOf(end) + end.length));
      }
    }
  });

  it('does not interpret quotes inside command comments as string delimiters', () => {
    for (const comment of ['* user\'s "note.', 'COMMENT user\'s "note.', '* note*.', 'COMMENT note/.']) {
      const source = `${comment}\r\n\r\nCOMPUTE x=1.\r\n`;
      assert.deepEqual(findCurrentCommand(source, source.indexOf('note')), { kind: 'none', reason: 'comment' });
      assert.equal(commandAt(source, 'COMPUTE'), 'COMPUTE x=1.');
    }
  });

  it('ignores structural-looking lines inside a continued comment', () => {
    for (const heading of ['* continued comment', 'COMMENT continued comment']) {
      const source = [heading, 'BEGIN DATA', 'END DATA.', '', 'COMPUTE x=1.', 'EXECUTE.'].join('\r\n');
      assert.equal(commandAt(source, 'COMPUTE'), 'COMPUTE x=1.');
      assert.deepEqual(scanCommands(source).map((range) => range.type), ['comment', 'command', 'command']);
    }
  });

  it('does not let fake delimiters inside inline comment text truncate syntax', () => {
    const source = [
      '/* BEGIN DATA', 'COMPUTE x=1. /* END DATA.', 'EXECUTE.',
    ].join('\n');
    assert.equal(scanCommands(source).some((range) => range.type === 'block'), false);
    assert.ok(commandAt(source, 'COMPUTE').endsWith('COMPUTE x=1. /* END DATA.'));
    assert.equal(commandAt(source, 'EXECUTE'), 'EXECUTE.');
    assert.equal(lexicalRegionAt(source, source.indexOf('BEGIN DATA') + 1), 'comment');
    assert.equal(lexicalRegionAt(source, source.indexOf('COMPUTE') + 1), 'code');
  });

  it('recognizes a real data block after an unclosed within-line comment', () => {
    const block = 'BEGIN DATA\r\n1\r\nEND DATA.';
    const source = `DATA LIST FREE /x. /* inline note\r\n${block}\r\nEXECUTE.`;
    assert.equal(commandAt(source, 'BEGIN DATA'), block);
    assert.equal(lexicalRegionAt(source, source.indexOf('\r\n1') + 3), 'begin-data');
    assert.equal(commandAt(source, 'EXECUTE'), 'EXECUTE.');
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

  it('keeps embedded-language text opaque while locating its closing delimiter', () => {
    const python = [
      'BEGIN PROGRAM PYTHON3.', 'message = """', 'BEGIN DATA', 'DO IF x=1.',
      '"""', 'print(message)', 'END PROGRAM.',
    ].join('\r\n');
    const source = `${python}\r\n\r\nEXECUTE.`;
    assert.equal(commandAt(source, 'message'), python);
    assert.equal(commandAt(source, 'EXECUTE'), 'EXECUTE.');
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
