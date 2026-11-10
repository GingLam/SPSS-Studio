import { inOpaqueSyntaxBlock, lexicalRegionAt, scanCommands, type CommandRange } from '../spss/commandScanner';
import { visibleCode } from './completionContext';
import { COMMAND_TEMPLATES, renderSyntaxTemplate, syntaxTemplate, type RenderedTemplate } from './completionTemplates';
import type { SpssVariableMetadata } from '../spss/types';
import { completionCommandNames, type SpssLanguageSchema } from './languageSchema';

type Role = 'numeric' | 'category' | 'outcome' | 'binaryOutcome' | 'predictor';
interface LocalSymbol { name: string; roles: Set<Role> }
interface CodingStatement { name: string; range: CommandRange; arguments: string }

export interface CodingDocument {
  ranges: CommandRange[];
  statements: CodingStatement[];
}

export interface NextCommandContext {
  local?: RenderedTemplate;
  payload?: string;
  previous: CommandRange;
  allowed: ReadonlySet<string>;
  symbols: ReadonlyMap<string, LocalSymbol>;
}

const identifier = /^[\p{L}@#$][\p{L}\p{M}\p{N}_@#$.]*$/u;
const reserved = new Set(['ALL', 'AND', 'BY', 'EQ', 'GE', 'GT', 'LE', 'LT', 'NE', 'NOT', 'OR', 'TO', 'WITH']);
const syntaxWords = new Set([...reserved, 'VARIABLE', 'VARIABLES', 'TABLES', 'ENTER', 'SCALE', 'NOMINAL', 'ORDINAL']);
const limitedTemplates: Record<string, Record<string, Role | 'any'>> = {
  dictionary: {},
  codebook: { variables: 'any' },
  frequencies: { variables: 'category' },
  descriptives: { variables: 'numeric' },
  examine: { variables: 'numeric' },
  'examine-groups': { variables: 'numeric', groups: 'category' },
  bar: { groups: 'category' },
  histogram: { variable: 'numeric' },
  scatter: { first: 'numeric', second: 'numeric' },
  correlations: { variables: 'numeric' },
  spearman: { variables: 'numeric' },
  crosstabs: { row: 'category', column: 'category' },
  means: { outcome: 'numeric', groups: 'category' },
  compute: {},
  recode: { variable: 'any' },
  sort: { keys: 'any' },
  'ttest-independent': { groups: 'category', outcome: 'numeric' },
  oneway: { groups: 'category', outcome: 'numeric' },
  regression: { outcome: 'outcome', predictors: 'predictor' },
  logistic: { outcome: 'binaryOutcome', predictors: 'predictor' },
  reliability: { variables: 'numeric' },
  factor: { variables: 'numeric' },
};

const listFields = new Set(['variables', 'predictors', 'keys']);

export const CODING_INSTRUCTION = [
  'Choose one useful next SPSS command from candidates based on the anonymous syntax sequence.',
  'Return JSON only: {"template":"id","bindings":{"field":["v1"]}} or {"template":null}.',
  'Only bind supplied variable IDs with matching roles. Leave uncertain fields absent.',
  'Never infer treatment, outcome, grouping, or a test design from a variable ID. Prefer minimal steps.',
].join(' ');

function commandPattern(command: string): RegExp {
  return new RegExp(`^${command.split(' ').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+')}(?=$|[\\s=(])`, 'iu');
}

type CommandMatcher = { name: string; pattern: RegExp };
const commandMatchers = new WeakMap<SpssLanguageSchema, Map<string, CommandMatcher[]>>();

function matchersFor(schema: SpssLanguageSchema): Map<string, CommandMatcher[]> {
  const existing = commandMatchers.get(schema);
  if (existing) return existing;
  const byHead = new Map<string, CommandMatcher[]>();
  const names = [...new Set([...completionCommandNames(schema), ...COMMAND_TEMPLATES.map(({ command }) => command)])]
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    const head = name.split(' ', 1)[0];
    if (!head) continue;
    const matches = byHead.get(head) ?? [];
    matches.push({ name, pattern: commandPattern(name) });
    byHead.set(head, matches);
  }
  commandMatchers.set(schema, byHead);
  return byHead;
}

export function analyzeCodingDocument(source: string, schema: SpssLanguageSchema): CodingDocument {
  const ranges = scanCommands(source);
  const matchers = matchersFor(schema);
  const statements: CodingStatement[] = [];
  for (const range of ranges) {
    if (range.type !== 'command') continue;
    const code = visibleCode(range.text).trim().replace(/\.$/u, '');
    const head = /^[^\s=(]+/u.exec(code)?.[0]?.toUpperCase() ?? '';
    for (const { name, pattern } of matchers.get(head) ?? []) {
      const match = pattern.exec(code);
      if (!match) continue;
      statements.push({ name, range, arguments: code.slice(match[0].length).trim() });
      break;
    }
  }
  return { ranges, statements };
}

function plainName(name: string): boolean {
  return identifier.test(name) && !name.endsWith('.') && !reserved.has(name.toUpperCase())
    && Buffer.byteLength(name, 'utf8') <= 64;
}

function fileDatasetName(filename: string, names: ReadonlySet<string>): string | undefined {
  const last = filename.split(/[\\/]/u).at(-1);
  if (!last || !/\.(?:sav|zsav)$/iu.test(last)) return undefined;
  let stem = last.replace(/\.(?:sav|zsav)$/iu, '').normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}_]+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!/^\p{L}/u.test(stem) || reserved.has(stem.toUpperCase())) stem = `dataset_${stem || 'data'}`;
  while (Buffer.byteLength(stem, 'utf8') > 58) stem = Array.from(stem).slice(0, -1).join('');
  for (let number = 1; number <= 999; number += 1) {
    const name = number === 1 ? stem : `${stem}_${String(number)}`;
    if (!names.has(name.toUpperCase())) return name;
  }
  return undefined;
}

function readQuotedValue(command: string, prefix: RegExp): string | undefined {
  const start = prefix.exec(command.trimStart());
  if (!start) return undefined;
  const value = /^(?:"((?:[^"\r\n]|"")*)"|'((?:[^'\r\n]|'')*)')/u.exec(command.trimStart().slice(start[0].length));
  if (value?.[1] !== undefined) return value[1].replace(/""/gu, '"');
  return value?.[2]?.replace(/''/gu, "'");
}

function renderLocal(id: string, chinese: boolean, bindings?: Record<string, string>): RenderedTemplate | undefined {
  const entry = syntaxTemplate(id);
  return entry ? renderSyntaxTemplate(entry.pattern, chinese, bindings) : undefined;
}

function localTemplate(
  statements: readonly CodingStatement[], chinese: boolean,
): RenderedTemplate | undefined {
  const current = statements.at(-1);
  if (!current) return undefined;
  if (current.name === 'CD' && readQuotedValue(current.range.text, /^CD\s+/iu)?.trim()) {
    return renderLocal('get-file', chinese);
  }
  if (current.name === 'GET FILE' || current.name === 'GET') {
    const filename = readQuotedValue(current.range.text, /^GET(?:\s+FILE)?\s*=?\s*/iu);
    if (!filename) return undefined;
    const names = new Set(statements.filter(({ name }) => ['DATASET NAME', 'DATASET DECLARE', 'DATASET COPY'].includes(name))
      .map((item) => item.arguments.split(/\s+/u)[0]?.toUpperCase() ?? ''));
    const dataset = fileDatasetName(filename, names);
    return renderLocal('dataset-name', chinese, dataset ? { dataset } : {});
  }
  if (current.name === 'DATASET NAME' && ['GET', 'GET FILE', 'GET DATA'].includes(statements.at(-2)?.name ?? '')) {
    const dataset = current.arguments.split(/\s+/u)[0];
    if (dataset && plainName(dataset)) {
      return renderLocal('dataset-activate', chinese, { dataset });
    }
  }
  return undefined;
}

function tokens(text: string): string[] {
  return (text.match(/[\p{L}@#$][\p{L}\p{M}\p{N}_@#$.]*/gu) ?? [])
    .filter((word) => plainName(word) && !syntaxWords.has(word.toUpperCase()));
}

function gatherSymbols(statements: readonly CodingStatement[]): LocalSymbol[] {
  const symbols = new Map<string, LocalSymbol>();
  const add = (values: readonly string[], ...roles: Role[]): void => {
    for (const name of values) {
      const key = name.toUpperCase();
      let symbol = symbols.get(key);
      if (!symbol) {
        symbol = { name, roles: new Set() };
        symbols.set(key, symbol);
      }
      for (const role of roles) symbol.roles.add(role);
    }
  };
  for (const { name, arguments: args } of statements) {
    const clean = args.replace(/^\/?\s*(?:VARIABLES?\b\s*=?)?/iu, '').trim();
    if (['GET', 'GET FILE', 'GET DATA', 'NEW FILE', 'DATASET ACTIVATE', 'DATASET CLOSE'].includes(name)) symbols.clear();
    if (['VARIABLE LABELS', 'MISSING VALUES', 'FORMATS', 'FREQUENCIES', 'CODEBOOK'].includes(name)) {
      add(tokens(clean.split('/')[0] ?? ''));
    } else if (name === 'VALUE LABELS' || name === 'ADD VALUE LABELS') {
      add(tokens(clean.split('/')[0] ?? '').slice(0, 1), 'category');
    } else if (name === 'VARIABLE LEVEL') {
      for (const group of clean.matchAll(/([^()]+)\((SCALE|NOMINAL|ORDINAL)\)/giu)) {
        add(tokens(group[1] ?? ''), group[2]?.toUpperCase() === 'SCALE' ? 'numeric' : 'category');
      }
    } else if (name === 'DATA LIST' || name === 'GET DATA') {
      const column = /(?:\/VARIABLES\s*=?|\/\s*)\s*([^/]+)$/iu.exec(args)?.[1];
      for (const definition of column?.matchAll(/([\p{L}@#$][\p{L}\p{M}\p{N}_@#$.]*)\s+\(?(A|F|N|COMMA|DOT|DATE)\d+(?:\.\d+)?/giu) ?? []) {
        add(tokens(definition[1] ?? ''), definition[2]?.toUpperCase() === 'A' ? 'category' : 'numeric');
      }
    } else if (['DESCRIPTIVES', 'CORRELATIONS', 'NONPAR CORR'].includes(name)) {
      add(tokens(clean.split('/')[0] ?? ''), 'numeric');
    } else if (name === 'CROSSTABS') {
      add(tokens((/TABLES\s*=?\s*([^/]+)/iu.exec(args)?.[1]) ?? ''), 'category');
    } else if (name === 'REGRESSION' || name === 'LOGISTIC REGRESSION') {
      const outcomes = name === 'REGRESSION'
        ? (/\/DEPENDENT\s*=?\s*([^/]+)/iu.exec(args)?.[1] ?? '')
        : (clean.split(/\bWITH\b|\//iu)[0] ?? '');
      add(tokens(outcomes).slice(0, 1), name === 'REGRESSION' ? 'outcome' : 'binaryOutcome',
        name === 'REGRESSION' ? 'numeric' : 'category');
      add(tokens(/\/METHOD\s*=?\s*ENTER\s+([^/]+)/iu.exec(args)?.[1] ?? ''), 'predictor');
    } else if (name === 'NUMERIC' || name === 'STRING') {
      const names = tokens(clean.replace(/\([^)]*\)/gu, ' '));
      if (name === 'NUMERIC') add(names, 'numeric');
      else add(names);
    } else if (name === 'COMPUTE') {
      add(tokens(clean.split('=')[0] ?? '').slice(0, 1));
    } else if (name === 'RECODE' || name === 'AUTORECODE') {
      add(tokens(/\bINTO\s+([^/]+)/iu.exec(args)?.[1] ?? ''));
    } else if (name === 'DELETE VARIABLES') {
      for (const name of tokens(clean)) symbols.delete(name.toUpperCase());
    } else if (name === 'RENAME VARIABLES' || name === 'MATCH FILES' || name === 'ADD FILES'
      || name === 'VARSTOCASES' || name === 'CASESTOVARS') {
      symbols.clear();
    }
  }
  return [...symbols.values()];
}

export function declaredVariablesBefore(
  source: string, offset: number, schema: SpssLanguageSchema,
): SpssVariableMetadata[] {
  const prefix = source.slice(0, offset);
  if (prefix.length > 120_000 || !prefix.includes('\n')) return [];
  const statements = analyzeCodingDocument(prefix, schema).statements
    .filter(({ range }) => /\.\s*$/u.test(visibleCode(range.text)));
  return gatherSymbols(statements).map((symbol, index) => ({
    index, name: symbol.name, label: '', type: symbol.roles.has('numeric') ? 'Numeric' : '', format: '',
  }));
}

function availableTemplates(symbols: ReadonlyMap<string, LocalSymbol>): Set<string> {
  const known = Array.from(symbols.values());
  const count = (role: Role): number => known.filter((symbol) => symbol.roles.has(role)).length;
  const allowed = new Set(['dictionary', 'codebook', 'frequencies', 'descriptives', 'examine', 'bar', 'histogram', 'compute']);
  if (known.length) ['recode', 'sort'].forEach((id) => allowed.add(id));
  if (count('numeric') >= 2) ['scatter', 'correlations', 'spearman', 'reliability', 'factor'].forEach((id) => allowed.add(id));
  if (count('category') >= 2) allowed.add('crosstabs');
  if (count('category') && count('numeric')) ['examine-groups', 'means', 'ttest-independent', 'oneway'].forEach((id) => allowed.add(id));
  if (count('numeric') >= 2 || (count('outcome') && count('predictor'))) allowed.add('regression');
  if (count('binaryOutcome') && count('predictor')) allowed.add('logistic');
  return allowed;
}

export function nextCommandContext(
  source: string, offset: number, document: CodingDocument, chinese: boolean,
): NextCommandContext | undefined {
  const lineStart = offset > 0 ? source.lastIndexOf('\n', offset - 1) + 1 : 0;
  const nextLine = source.indexOf('\n', offset);
  if (!lineStart || source.slice(lineStart, nextLine < 0 ? source.length : nextLine).trim()) return undefined;
  const priorLineStart = source.lastIndexOf('\n', lineStart - 2) + 1;
  if (!source.slice(priorLineStart, lineStart - 1).trim()) return undefined;
  const previous = document.ranges.filter((range) => range.end <= lineStart).at(-1);
  if (!previous || previous.end <= priorLineStart || previous.type === 'comment'
    || document.ranges.some((range) => range.start < lineStart && range.end > lineStart)) return undefined;
  const last = visibleCode(previous.text).trim();
  if (previous.type === 'command' && (!/\.$/u.test(last) || /[=+*/-]\s*\.$/u.test(last))) return undefined;
  const prefix = source.slice(0, lineStart);
  if (inOpaqueSyntaxBlock(prefix, lineStart) || lexicalRegionAt(prefix, lineStart) !== 'blank') return undefined;
  const statements = document.statements.filter(({ range }) => range.end <= lineStart);
  const current = statements.at(-1);
  if (current && current.range === previous && ['GET', 'GET FILE', 'CD'].includes(current.name)
    && !readQuotedValue(previous.text, /^(?:CD\s+|GET(?:\s+FILE)?\s*=?\s*)/iu)?.trim()) return undefined;
  const local = current?.range === previous ? localTemplate(statements, chinese) : undefined;
  if (local) {
    const next = source.slice(nextLine < 0 ? source.length : nextLine + 1).trimStart();
    const following = /^(DATASET (?:NAME|ACTIVATE)|GET FILE)\b/iu.exec(next)?.[1]?.toUpperCase();
    if (following && local.text.startsWith(following)) return undefined;
    return { local, previous, allowed: new Set(), symbols: new Map() };
  }
  if (!current || ['CD', 'NEW FILE', 'DATASET CLOSE', 'FINISH', 'HOST', 'ERASE', 'INSERT', 'INCLUDE'].includes(current.name)) return undefined;
  if (previous.type === 'block' && previous.blockType !== 'data') return undefined;
  const symbols = new Map(gatherSymbols(statements).slice(-32).map((symbol, index) => [`v${String(index + 1)}`, symbol]));
  const allowed = availableTemplates(symbols);
  const payload = JSON.stringify({
    commands: statements.slice(-24).map(({ name }) => name),
    variables: Array.from(symbols, ([id, symbol]) => ({ id, roles: [...symbol.roles] })),
    candidates: Array.from(allowed, (id) => ({ id, fields: limitedTemplates[id] })),
  });
  return { payload, previous, allowed, symbols };
}

export function parseCodingChoice(
  response: string, context: NextCommandContext, chinese: boolean,
): RenderedTemplate | undefined {
  if (response.length > 4_096) return undefined;
  try {
    const content = response.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu, '$1');
    const choice = JSON.parse(content) as { template?: unknown; bindings?: unknown } | null;
    if (!choice || typeof choice.template !== 'string' || !context.allowed.has(choice.template)) return undefined;
    const entry = syntaxTemplate(choice.template);
    const fields = limitedTemplates[choice.template];
    if (!entry || !fields || entry.pattern.includes('\n')) return undefined;
    if (choice.bindings !== undefined && (!choice.bindings || typeof choice.bindings !== 'object' || Array.isArray(choice.bindings))) return undefined;
    const bindings: Record<string, string> = {};
    for (const [field, ids] of Object.entries(choice.bindings ?? {})) {
      const role = Object.hasOwn(fields, field) ? fields[field] : undefined;
      if (!role || !Array.isArray(ids) || ids.length < 1 || ids.length > 8 || (!listFields.has(field) && ids.length !== 1)) return undefined;
      const symbols = ids.map((id: unknown) => typeof id === 'string' ? context.symbols.get(id) : undefined);
      if (symbols.some((symbol) => !symbol || (role !== 'any' && !symbol.roles.has(role)))) return undefined;
      if (new Set(ids).size !== ids.length) return undefined;
      bindings[field] = symbols.map((symbol) => symbol?.name ?? '').join(' ');
    }
    if (bindings.outcome && bindings.predictors?.split(' ').includes(bindings.outcome)) return undefined;
    if ((bindings.first && bindings.first === bindings.second) || (bindings.row && bindings.row === bindings.column)) return undefined;
    if (['correlations', 'spearman', 'reliability', 'factor'].includes(entry.id)
      && bindings.variables && bindings.variables.split(' ').length < 2) return undefined;
    return renderSyntaxTemplate(entry.pattern, chinese, bindings);
  } catch {
    return undefined;
  }
}
