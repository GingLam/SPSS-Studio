import { COMMAND_TEMPLATES } from './completionTemplates';
import { lexicalRegionAt, scanCommands } from '../spss/commandScanner';
import { allSchemaFunctions, completionCommandNames, type SpssLanguageSchema } from './languageSchema';

export type CompletionContextKind =
  | 'COMMAND_START'
  | 'COMMAND_NAME'
  | 'COMMAND_END'
  | 'FILE_ARGUMENT'
  | 'SUBCOMMAND'
  | 'VARIABLE_LIST'
  | 'EXPRESSION'
  | 'FUNCTION_ARGUMENT'
  | 'MACRO'
  | 'STRING'
  | 'COMMENT'
  | 'BEGIN_DATA'
  | 'EMBEDDED_PROGRAM'
  | 'UNKNOWN';

export interface CompletionContext {
  kind: CompletionContextKind;
  prefix: string;
  replaceStart: number;
  commandName?: string;
}

function wordPrefix(text: string, offset: number): { prefix: string; replaceStart: number } {
  const match = /[\p{L}\p{M}\p{N}_@#$!.]*$/u.exec(text.slice(0, offset));
  const prefix = match?.[0] ?? '';
  return { prefix, replaceStart: offset - prefix.length };
}

function commandAtStart(value: string, commands: string[]): string | undefined {
  const normalized = value.trimStart().replace(/\s+/gu, ' ').toUpperCase();
  return [...commands]
    .sort((left, right) => right.length - left.length)
    .find((command) => normalized === command || normalized.startsWith(`${command} `) || normalized.startsWith(`${command}=`));
}

/** Keep positions while hiding strings and native line-local comments. */
export function visibleCode(text: string): string {
  let result = '';
  let quote: string | undefined;
  let comment = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    const next = text[index + 1];
    if (comment) {
      result += /[\r\n]/u.test(character) ? character : ' ';
      if (character === '*' && next === '/') { result += ' '; index += 1; comment = false; }
      else if (character === '\n') { comment = false; }
    } else if (quote) {
      result += /[\r\n]/u.test(character) ? character : ' ';
      if (character === quote && next === quote) { result += ' '; index += 1; }
      else if (character === quote) { quote = undefined; }
    } else if (character === '/' && next === '*') {
      result += '  '; index += 1; comment = true;
    } else if (character === '"' || character === "'") {
      result += ' '; quote = character;
    } else { result += character; }
  }
  return result;
}

/** Analyzes completion without contacting SPSS. */
export function analyzeCompletionContext(
  text: string,
  offset: number,
  schema: SpssLanguageSchema,
): CompletionContext {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, safeOffset);
  const lexical = lexicalRegionAt(before, before.length);
  const { prefix, replaceStart } = wordPrefix(text, safeOffset);
  const suppressed: Partial<Record<typeof lexical, CompletionContextKind>> = {
    string: 'STRING',
    comment: 'COMMENT',
    'begin-data': 'BEGIN_DATA',
    'embedded-program': 'EMBEDDED_PROGRAM',
  };
  const suppressedKind = suppressed[lexical];
  if (suppressedKind) {
    return { kind: suppressedKind, prefix, replaceStart };
  }

  // Scan the prefix so a surrounding control block cannot hide its current
  // statement, and text after the caret cannot affect the completion context.
  const range = scanCommands(before).at(-1);
  const commands = [...completionCommandNames(schema), ...COMMAND_TEMPLATES.map(({ command }) => command)];
  const code = visibleCode(range ? before.slice(range.start) : before);
  const commandName = commandAtStart(code, commands);
  const slash = code.lastIndexOf('/');
  const section = slash < 0 ? '' : code.slice(slash);
  const fileArgument = ['GET FILE', 'GET DATA', 'GET STATA', 'GET SAS', 'SAVE TRANSLATE', 'OUTPUT SAVE', 'INSERT', 'INCLUDE', 'SAVE', 'XSAVE', 'CD', 'FILE HANDLE'].includes(commandName ?? '')
    && (slash < 0 || /^\/\s*(?:FILE|OUTFILE|INFILE)\b/iu.test(section));
  const dottedFunction = prefix.includes('.') && allSchemaFunctions(schema)
    .some((name) => name.toUpperCase().startsWith(prefix.toUpperCase()));
  const withinDottedName = prefix.endsWith('.') && /^[\p{L}\p{M}\p{N}_@#$]/u.test(text.slice(safeOffset));
  const completed = range && (range.type === 'block' || /\.\s*$/u.test(visibleCode(range.text)));
  if (completed && !dottedFunction && !withinDottedName) {
    if (safeOffset <= range.end) { return { kind: fileArgument ? 'FILE_ARGUMENT' : 'COMMAND_END', prefix, replaceStart }; }
    return { kind: 'COMMAND_START', prefix: '', replaceStart: safeOffset };
  }
  const commandText = code;
  const trimmed = commandText.trimStart();
  if (!trimmed) {
    return { kind: 'COMMAND_START', prefix, replaceStart };
  }
  const normalized = trimmed.replace(/\s+/gu, ' ').toUpperCase();
  if (prefix.startsWith('!')) { return { kind: 'MACRO', prefix, replaceStart }; }
  const isCommandPrefix = commands.some((command) => command.startsWith(normalized));
  if (isCommandPrefix && !/[=/()]/u.test(trimmed)) {
    return { kind: 'COMMAND_NAME', prefix: normalized, replaceStart: safeOffset - trimmed.length };
  }

  const expressionCommand = /^(?:COMPUTE|IF|SELECT IF|DO IF|ELSE IF|LOOP|END LOOP)$/u.test(commandName ?? '');
  const subcommandMatch = /\/\s*([A-Z0-9_-]*)$/iu.exec(commandText);
  if (subcommandMatch && !expressionCommand) {
    const subcommandPrefix = subcommandMatch[1] ?? '';
    return {
      kind: 'SUBCOMMAND',
      prefix: subcommandPrefix,
      replaceStart: safeOffset - subcommandPrefix.length,
      ...(commandName ? { commandName } : {}),
    };
  }
  const openParentheses = (commandText.match(/\(/gu) ?? []).length;
  const closeParentheses = (commandText.match(/\)/gu) ?? []).length;
  if (openParentheses > closeParentheses) {
    return { kind: 'FUNCTION_ARGUMENT', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
  }
  if (/\/\s*(?:VARIABLES|DEPENDENT|TABLES|ANALYSIS|CATEGORICAL|PAIRS)\b/iu.test(section)
    || /\/\s*METHOD\s*=\s*(?:ENTER|FORWARD|BACKWARD|STEPWISE)\s+/iu.test(section)
    || /\bVARIABLES?\s*=\s*[^.]*$/iu.test(commandText)
    || (!commandText.includes('/') && /^\s*(?:DESCRIPTIVES|FREQUENCIES|CORRELATIONS|RECODE)\b/iu.test(commandText))) {
    return { kind: 'VARIABLE_LIST', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
  }
  if (fileArgument) {
    return { kind: 'FILE_ARGUMENT', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
  }
  if (/[=,(+\-*/]/u.test(commandText)
    || expressionCommand) {
    return { kind: 'EXPRESSION', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
  }
  return { kind: 'UNKNOWN', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
}
