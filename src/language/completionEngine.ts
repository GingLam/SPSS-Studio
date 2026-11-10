import type { SpssVariableMetadata } from '../spss/types';
import {
  COMMAND_TEMPLATES, functionTemplate, renderSyntaxTemplate, type RenderedTemplate,
} from './completionTemplates';
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
  template?: RenderedTemplate;
  filterText?: string;
}

const commonCommands = [
  'GET FILE', 'GET DATA', 'COMPUTE', 'CROSSTABS', 'CODEBOOK', 'CD', 'CORRELATIONS',
  'DESCRIPTIVES', 'DATASET NAME', 'DATASET ACTIVATE', 'DATASET DISPLAY', 'DISPLAY',
  'RECODE', 'REGRESSION', 'RELIABILITY', 'SORT CASES', 'SELECT IF', 'SAVE', 'SAVE TRANSLATE',
  'FREQUENCIES', 'FORMATS', 'GRAPH', 'T-TEST', 'EXAMINE', 'EXECUTE', 'IF', 'DO IF',
  'VALUE LABELS', 'VARIABLE LABELS', 'VARIABLE LEVEL', 'MISSING VALUES', 'MEANS',
  'LOGISTIC REGRESSION', 'ONEWAY', 'UNIANOVA', 'AGGREGATE', 'ADD FILES', 'MATCH FILES',
  'WEIGHT', 'FILTER', 'SPLIT FILE', 'RENAME VARIABLES', 'NUMERIC', 'STRING',
];

const commonFunctions = [
  'MEAN', 'SUM', 'MIN', 'MAX', 'SD', 'ABS', 'SQRT', 'LN', 'LG10', 'MISSING', 'SYSMIS',
  'ANY', 'RANGE', 'RND', 'TRUNC', 'LAG', 'DATE.MDY', 'CHAR.LENGTH', 'CHAR.SUBSTR',
];

function priority(name: string, common: readonly string[], fallback: number): number {
  const rank = common.indexOf(name);
  return rank < 0 ? fallback : rank;
}

function attachTemplate(item: CompletionCandidate, value: RenderedTemplate): CompletionCandidate {
  return { ...item, template: value, insertText: value.snippet, snippet: true };
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
    sortText: `${String(rank).padStart(3, '0')}-${label.toUpperCase()}`,
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
  chinese = false,
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
  if (mode === 'automatic' && context.kind !== 'SUBCOMMAND' && !context.prefix.trim()) { return []; }
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
      const verified = functionTemplate(name, chinese);
      const item = candidate(name, name, 'function',
        rank + priority(name, commonFunctions, 100), false, 'SPSS function');
      results.push(verified ? attachTemplate(item, verified) : item);
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
    const names = new Set([...completionCommandNames(schema), ...COMMAND_TEMPLATES.map(({ command }) => command)]);
    for (const command of names) {
      if (!matchesPrefix(command, context.prefix)) continue;
      const templates = COMMAND_TEMPLATES.filter((entry) => entry.command === command);
      const rank = 4 * priority(command, commonCommands, 125);
      const first = templates[0];
      const item = candidate(command, command, 'command', rank);
      results.push(first ? attachTemplate(item, renderSyntaxTemplate(first.pattern, chinese)) : item);
      for (const [index, variant] of templates.slice(1).entries()) {
        const option = candidate(`${command} · ${variant.variant ?? variant.id}`, command, 'snippet', rank + index + 1);
        results.push(attachTemplate({ ...option, filterText: command }, renderSyntaxTemplate(variant.pattern, chinese)));
      }
    }
  } else if (context.kind === 'SUBCOMMAND') {
    const specific = context.commandName
      ? (schema.completion.commandSubcommands[context.commandName === 'GET FILE' ? 'GET' : context.commandName] ?? [])
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
    addFunctions(20);
  } else if (context.kind === 'EXPRESSION') {
    addVariables(0);
    addFunctions(10);
    addKeywords(250);
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
