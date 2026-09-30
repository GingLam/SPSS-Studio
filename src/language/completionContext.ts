import { lexicalRegionAt, scanCommands } from '../spss/commandScanner';
import type { SpssLanguageSchema } from './languageSchema';

export type CompletionContextKind =
  | 'COMMAND_START'
  | 'COMMAND_NAME'
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
  const match = /[A-Z0-9_@#$.-]*$/iu.exec(text.slice(0, offset));
  const prefix = match?.[0] ?? '';
  return { prefix, replaceStart: offset - prefix.length };
}

function commandAtStart(value: string, commands: string[]): string | undefined {
  const normalized = value.trimStart().toUpperCase();
  return [...commands]
    .sort((left, right) => right.length - left.length)
    .find((command) => normalized === command || normalized.startsWith(`${command} `) || normalized.startsWith(`${command}\n`));
}

/** Analyzes completion without contacting SPSS. */
export function analyzeCompletionContext(
  text: string,
  offset: number,
  schema: SpssLanguageSchema,
): CompletionContext {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const lexical = lexicalRegionAt(text, safeOffset);
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

  const range = scanCommands(text).find((candidate) => safeOffset >= candidate.start && safeOffset <= candidate.end);
  const commandText = range ? text.slice(range.start, safeOffset) : text.slice(0, safeOffset);
  const trimmed = commandText.trimStart();
  if (!trimmed) {
    return { kind: 'COMMAND_START', prefix, replaceStart };
  }
  const normalized = trimmed.replace(/\s+/gu, ' ').toUpperCase();
  const isCommandPrefix = schema.commands.some((command) => command.startsWith(normalized));
  if (isCommandPrefix && !/[=/()]/u.test(trimmed)) {
    return { kind: 'COMMAND_NAME', prefix: trimmed, replaceStart: safeOffset - trimmed.length };
  }

  const commandName = commandAtStart(trimmed, schema.commands);
  const subcommandMatch = /\/\s*([A-Z0-9_-]*)$/iu.exec(commandText);
  if (subcommandMatch) {
    const subcommandPrefix = subcommandMatch[1] ?? '';
    return {
      kind: 'SUBCOMMAND',
      prefix: subcommandPrefix,
      replaceStart: safeOffset - subcommandPrefix.length,
      ...(commandName ? { commandName } : {}),
    };
  }
  if (prefix.startsWith('!')) {
    return { kind: 'MACRO', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
  }

  const openParentheses = (commandText.match(/\(/gu) ?? []).length;
  const closeParentheses = (commandText.match(/\)/gu) ?? []).length;
  if (openParentheses > closeParentheses) {
    return { kind: 'FUNCTION_ARGUMENT', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
  }
  if (/\bVARIABLES?\s*=\s*[^.]*$/iu.test(commandText)
    || /^\s*(?:DESCRIPTIVES|FREQUENCIES)\b[^.]*$/iu.test(commandText)) {
    return { kind: 'VARIABLE_LIST', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
  }
  if (/[=,(+\-*/]/u.test(commandText)
    || /^\s*(?:COMPUTE|IF|SELECT\s+IF|DO\s+IF)\b/iu.test(commandText)) {
    return { kind: 'EXPRESSION', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
  }
  return { kind: 'UNKNOWN', prefix, replaceStart, ...(commandName ? { commandName } : {}) };
}
