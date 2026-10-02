(() => {
  'use strict';

  window.createSpssTokenizer = (syntaxData) => {
    const upperSet = (values) => new Set((values || []).map((value) => String(value).toUpperCase()));
    const controlCommands = upperSet(syntaxData.controlCommands);
    const macroDirectives = upperSet(syntaxData.macroDirectives);
    const systemVariables = upperSet(syntaxData.systemVariables);
    const ordinaryKeywords = upperSet([
      ...(syntaxData.reservedKeywords || []),
      ...(syntaxData.structuralKeywords || []),
      ...(syntaxData.completionKeywords || []),
    ]);
    const logicalKeywords = new Set(['AND', 'OR', 'NOT']);
    const relationalKeywords = new Set(['EQ', 'NE', 'LT', 'LE', 'GT', 'GE']);
    const missingKeywords = new Set(['SYSMIS', 'MISSING', 'LO', 'HI', 'THRU']);

    function escapeRegex(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    }

    const formatPatterns = [...upperSet(syntaxData.formats)].map((format) => new RegExp(
      `^${escapeRegex(format)}\\d+(?:\\.\\d+)?$`,
      'iu',
    ));

    function phrasePatterns(values, type) {
      return [...values]
        .sort((left, right) => right.length - left.length || left.localeCompare(right))
        .map((value) => ({
          type,
          regex: new RegExp(`^${value.split(/\s+/u).map(escapeRegex).join('\\s+')}(?=\\s|\\.|$)`, 'iu'),
        }));
    }

    const commandPatterns = [
      ...phrasePatterns(syntaxData.controlCommands || [], 'command-control'),
      ...phrasePatterns(
        (syntaxData.commands || []).filter((command) => !controlCommands.has(String(command).toUpperCase())),
        'command',
      ),
    ].sort((left, right) => right.regex.source.length - left.regex.source.length);

    function matchCommand(source) {
      for (const candidate of commandPatterns) {
        const match = source.match(candidate.regex);
        if (match) return { type: candidate.type, content: match[0] };
      }
      return undefined;
    }

    function pushToken(tokens, type, content) {
      if (!content) return;
      const previous = tokens[tokens.length - 1];
      if (previous?.type === type) {
        previous.content += content;
      } else {
        tokens.push({ type, content });
      }
    }

    return (source) => {
      const tokens = [];
      let inBlockComment = false;
      let inCommandComment = false;
      let rawBlockEnd;
      for (const lineWithEnding of source.match(/.*(?:\n|$)/gu) || []) {
        if (!lineWithEnding) continue;
        const line = lineWithEnding.endsWith('\n') ? lineWithEnding.slice(0, -1) : lineWithEnding;
        const ending = lineWithEnding.endsWith('\n') ? '\n' : '';
        if (rawBlockEnd && !new RegExp(`^\\s*${rawBlockEnd.replace(' ', '\\s+')}\\b`, 'iu').test(line)) {
          pushToken(tokens, 'plain', lineWithEnding);
          continue;
        }
        if (rawBlockEnd) rawBlockEnd = undefined;
        if (inCommandComment || (!inBlockComment && /^\s*(?:\*|COMMENT\b)/iu.test(line))) {
          pushToken(tokens, 'comment', line);
          pushToken(tokens, 'plain', ending);
          inCommandComment = !/\.\s*$/u.test(line);
          continue;
        }

        const leading = line.match(/^\s*/u)?.[0] || '';
        pushToken(tokens, 'plain', leading);
        let cursor = leading.length;
        let firstWord = true;
        let afterSlash = false;
        const command = line[cursor] === '!' ? undefined : matchCommand(line.slice(cursor));
        if (command) {
          pushToken(tokens, command.type, command.content);
          cursor += command.content.length;
          firstWord = false;
        }
        while (cursor < line.length) {
          if (inBlockComment) {
            const end = line.indexOf('*/', cursor);
            if (end < 0) {
              pushToken(tokens, 'comment', line.slice(cursor));
              cursor = line.length;
            } else {
              pushToken(tokens, 'comment', line.slice(cursor, end + 2));
              cursor = end + 2;
              inBlockComment = false;
            }
            continue;
          }
          if (line.startsWith('/*', cursor)) {
            inBlockComment = true;
            continue;
          }

          const remainder = line.slice(cursor);
          const whitespace = remainder.match(/^\s+/u);
          if (whitespace) {
            pushToken(tokens, 'plain', whitespace[0]);
            cursor += whitespace[0].length;
            continue;
          }
          const quote = remainder[0];
          if (quote === "'" || quote === '"') {
            let end = 1;
            while (end < remainder.length) {
              if (remainder[end] === quote) {
                if (remainder[end + 1] === quote) {
                  end += 2;
                  continue;
                }
                end += 1;
                break;
              }
              end += 1;
            }
            pushToken(tokens, 'string', remainder.slice(0, end));
            cursor += end;
            continue;
          }

          const number = remainder.match(/^(?:\d+\.\d*|\.\d+|\d+)(?:e[+-]?\d+)?/iu);
          if (number) {
            pushToken(tokens, 'number', number[0]);
            cursor += number[0].length;
            firstWord = false;
            afterSlash = false;
            continue;
          }
          const word = remainder.match(/^[A-Z@#$!][A-Z0-9_@#$!-]*(?:\.[A-Z0-9_@#$-]+)*/iu);
          if (word) {
            const value = word[0];
            const upper = value.toUpperCase();
            const nextCharacter = remainder.slice(value.length).trimStart()[0];
            let type = 'variable';
            if (macroDirectives.has(upper)) {
              type = 'macro-directive';
            } else if (value.startsWith('!')) {
              type = 'variable-macro';
            } else if (systemVariables.has(upper) || value.startsWith('$')) {
              type = 'variable-system';
            } else if (value.startsWith('#')) {
              type = 'variable-scratch';
            } else if (afterSlash) {
              type = 'subcommand';
            } else if (formatPatterns.some((pattern) => pattern.test(value))) {
              type = 'format';
            } else if (nextCharacter === '(') {
              type = 'function';
            } else if (missingKeywords.has(upper)) {
              type = 'constant-missing';
            } else if (logicalKeywords.has(upper)) {
              type = 'operator-logical';
            } else if (relationalKeywords.has(upper)) {
              type = 'operator-relational';
            } else if (ordinaryKeywords.has(upper)) {
              type = 'keyword';
            } else if (firstWord) {
              type = 'command';
            }
            pushToken(tokens, type, value);
            cursor += value.length;
            firstWord = false;
            afterSlash = false;
            continue;
          }

          if (/^\/[A-Z]/iu.test(remainder)) {
            pushToken(tokens, 'punctuation', '/');
            cursor += 1;
            afterSlash = true;
            continue;
          }
          const operator = remainder.match(/^(?:<=|>=|~=|<>|\*\*|[=<>+*/&|~-])/u);
          if (operator) {
            const content = operator[0];
            const type = /^(?:<=|>=|~=|<>|=|<|>)$/u.test(content)
              ? 'operator-relational'
              : /^(?:&|\||~)$/u.test(content)
                ? 'operator-logical'
                : 'operator-arithmetic';
            pushToken(tokens, type, content);
            cursor += operator[0].length;
            afterSlash = false;
            continue;
          }
          pushToken(tokens, 'punctuation', remainder[0]);
          cursor += 1;
        }
        pushToken(tokens, 'plain', ending);
        const blockStart = line.trim().toUpperCase();
        if (/^BEGIN\s+DATA(?:\.|\s|$)/u.test(blockStart)) {
          rawBlockEnd = 'END DATA';
        } else if (/^BEGIN\s+PROGRAM(?:\s|\.|$)/u.test(blockStart)) {
          rawBlockEnd = 'END PROGRAM';
        } else if (/^BEGIN\s+GPL(?:\.|\s|$)/u.test(blockStart)) {
          rawBlockEnd = 'END GPL';
        }
      }
      return tokens;
    };
  };
})();
