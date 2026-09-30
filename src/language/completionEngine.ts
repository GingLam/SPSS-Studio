import type { SpssVariableMetadata } from '../spss/types';
import type { CompletionContext } from './completionContext';
import { allSchemaFunctions, type SpssLanguageSchema } from './languageSchema';

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
): CompletionCandidate[] {
  if (['STRING', 'COMMENT', 'BEGIN_DATA', 'EMBEDDED_PROGRAM'].includes(context.kind)) {
    return [];
  }
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

  if (context.kind === 'COMMAND_START' || context.kind === 'COMMAND_NAME' || context.kind === 'UNKNOWN') {
    for (const command of schema.commands) {
      if (matchesPrefix(command, context.prefix)) {
        results.push(candidate(command, command, 'command', 0));
      }
    }
    for (const snippet of schema.completion.snippets) {
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
    if (context.kind === 'UNKNOWN') {
      addVariables(2);
    }
  } else if (context.kind === 'SUBCOMMAND') {
    const specific = context.commandName
      ? (schema.completion.commandSubcommands[context.commandName] ?? [])
      : [];
    const seen = new Set<string>();
    for (const name of specific) {
      if (matchesPrefix(name, context.prefix)) {
        seen.add(name);
        results.push(candidate(`/${name}`, name, 'subcommand', 0, false, `${context.commandName ?? 'SPSS'} subcommand`));
      }
    }
    for (const name of schema.subcommands) {
      if (!seen.has(name) && matchesPrefix(name, context.prefix)) {
        results.push(candidate(`/${name}`, name, 'subcommand', 1, false, 'Generic SPSS subcommand'));
      }
    }
  } else if (context.kind === 'VARIABLE_LIST' || context.kind === 'FUNCTION_ARGUMENT') {
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
  }
  return results.sort((left, right) => left.sortText.localeCompare(right.sortText));
}
