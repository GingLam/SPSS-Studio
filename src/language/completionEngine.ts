import type { SpssVariableMetadata } from '../spss/types';
import type { CompletionContext } from './completionContext';
import { allSchemaFunctions, completionCommandNames, type SpssLanguageSchema } from './languageSchema';

export type CompletionCandidateKind = 'command' | 'subcommand' | 'keyword' | 'function' | 'snippet' | 'variable' | 'macro';

export interface CompletionCandidate {
  label: string;
  insertText: string;
  kind: CompletionCandidateKind;
  sortText: string;
  detail?: string;
  documentation?: string;
  snippet: boolean;
}

function matchesPrefix(candidate: string, prefix: string): boolean {
  return candidate.toUpperCase().startsWith(prefix.trim().toUpperCase());
}

function candidate(
  label: string,
  insertText: string,
  kind: CompletionCandidateKind,
  rank: number,
  snippet = false,
  detail?: string,
  documentation?: string,
): CompletionCandidate {
  return {
    label,
    insertText,
    kind,
    sortText: `${String(rank).padStart(2, '0')}-${label.toUpperCase()}`,
    ...(detail ? { detail } : {}),
    ...(documentation ? { documentation } : {}),
    snippet,
  };
}

function variableDetail(variable: SpssVariableMetadata): string {
  return [variable.type, variable.measurementLevel, variable.format].filter(Boolean).join(' · ');
}

export function getCompletionCandidates(
  context: CompletionContext,
  schema: SpssLanguageSchema,
  variables: readonly SpssVariableMetadata[],
  mode: 'automatic' | 'manual' = 'automatic',
): CompletionCandidate[] {
  if (['STRING', 'COMMENT', 'BEGIN_DATA', 'EMBEDDED_PROGRAM', 'FILE_ARGUMENT'].includes(context.kind)) {
    return [];
  }
  if (context.kind === 'COMMAND_END') {
    // A point is also legal inside a variable name. Keep a valid terminator
    // quiet, but permit an unambiguous dotted-name continuation or manual ask.
    const prefix = context.prefix.toUpperCase();
    if (!prefix.endsWith('.') || prefix.length < 2
      || (mode === 'automatic' && variables.some((variable) => variable.name.toUpperCase() === prefix.slice(0, -1)))) { return []; }
    return variables.filter((variable) => matchesPrefix(variable.name, prefix))
      .map((variable) => candidate(variable.name, variable.name, 'variable', 0, false, variableDetail(variable), variable.label || undefined));
  }
  if (mode === 'automatic' && context.kind !== 'SUBCOMMAND' && Array.from(context.prefix.trim()).length < 2) { return []; }
  const results: CompletionCandidate[] = [];
  const addVariables = (rank: number): void => {
    for (const variable of variables) {
      if (matchesPrefix(variable.name, context.prefix)) {
        results.push(candidate(
          variable.name,
          variable.name,
          'variable',
          rank,
          false,
          variableDetail(variable),
          variable.label || undefined,
        ));
      }
    }
  };
  const addFunctions = (rank: number): void => {
    for (const name of allSchemaFunctions(schema)) {
      if (!matchesPrefix(name, context.prefix)) {
        continue;
      }
      const verified = schema.completion.functionSnippets[name];
      results.push(candidate(
        name,
        verified ?? `${name}(\${1:arguments})`,
        'function',
        rank,
        true,
        'SPSS function',
      ));
    }
  };
  const addKeywords = (rank: number): void => {
    for (const keyword of schema.completion.keywords) {
      if (matchesPrefix(keyword, context.prefix)) {
        results.push(candidate(keyword, keyword, 'keyword', rank));
      }
    }
  };

  if (context.kind === 'COMMAND_START' || context.kind === 'COMMAND_NAME') {
    for (const command of completionCommandNames(schema)) {
      if (matchesPrefix(command, context.prefix)) {
        results.push(candidate(command, command, 'command', 0));
      }
    }
    for (const snippet of mode === 'manual' ? schema.completion.snippets : []) {
      if (matchesPrefix(snippet.label, context.prefix)) {
        results.push(candidate(
          `${snippet.label} snippet`,
          snippet.body,
          'snippet',
          1,
          true,
          snippet.description,
        ));
      }
    }
  } else if (context.kind === 'SUBCOMMAND') {
    const specific = context.commandName
      ? (schema.completion.commandSubcommands[context.commandName] ?? [])
      : [];
    for (const name of specific) {
      if (matchesPrefix(name, context.prefix)) {
        results.push(candidate(`/${name}`, name, 'subcommand', 0, false, `${context.commandName ?? 'SPSS'} subcommand`));
      }
    }
  } else if (context.kind === 'VARIABLE_LIST') {
    addVariables(0);
    for (const keyword of ['ALL', 'BY', 'TO', 'WITH']) {
      if (matchesPrefix(keyword, context.prefix)) { results.push(candidate(keyword, keyword, 'keyword', 1)); }
    }
  } else if (context.kind === 'FUNCTION_ARGUMENT') {
    addVariables(0);
    addKeywords(1);
    addFunctions(2);
  } else if (context.kind === 'EXPRESSION') {
    addVariables(0);
    addFunctions(1);
    addKeywords(2);
  } else if (context.kind === 'MACRO') {
    for (const directive of schema.macroDirectives) {
      if (matchesPrefix(directive, context.prefix)) {
        results.push(candidate(directive, directive, 'macro', 0));
      }
    }
  } else if (context.kind === 'UNKNOWN' && context.commandName) {
    // Unknown argument structure is not permission to suggest new commands.
    // Preserve cached variable names for SORT CASES, DELETE VARIABLES, etc.
    addVariables(0);
  }
  return results.sort((left, right) => left.sortText.localeCompare(right.sortText));
}
