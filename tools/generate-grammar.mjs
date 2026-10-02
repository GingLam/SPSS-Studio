import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(projectRoot, 'syntax', 'spss-language.json');
const highlightingPath = path.join(projectRoot, 'syntax', 'spss-highlighting.json');
const grammarPath = path.join(projectRoot, 'syntaxes', 'spss.tmLanguage.json');
const coveragePath = path.join(projectRoot, 'docs', 'SYNTAX-COVERAGE.md');
const webviewSyntaxPath = path.join(projectRoot, 'media', 'spss-syntax-data.js');
const webviewThemePath = path.join(projectRoot, 'media', 'spss-theme.css');
const lightThemePath = path.join(projectRoot, 'themes', 'spss-studio-light-color-theme.json');
const darkThemePath = path.join(projectRoot, 'themes', 'spss-studio-dark-color-theme.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const highlighting = JSON.parse(fs.readFileSync(highlightingPath, 'utf8'));

function assertUnique(name, values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${name} must be a non-empty array.`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${name} contains duplicate entries.`);
  }
}

for (const name of [
  'commands', 'controlCommands', 'reservedKeywords', 'structuralKeywords',
  'subcommands', 'functions', 'distributionFamilies', 'distributions', 'formats',
  'macroDirectives', 'systemVariables',
]) {
  assertUnique(name, manifest[name]);
}

if (!manifest.completion || typeof manifest.completion !== 'object') {
  throw new Error('completion must be an object.');
}
assertUnique('completion.keywords', manifest.completion.keywords);
for (const [command, subcommands] of Object.entries(manifest.completion.commandSubcommands)) {
  if (!manifest.commands.includes(command)) {
    throw new Error(`Completion schema references unknown command: ${command}`);
  }
  assertUnique(`completion.commandSubcommands.${command}`, subcommands);
}
for (const functionName of Object.keys(manifest.completion.functionSnippets)) {
  if (!manifest.functions.includes(functionName)) {
    throw new Error(`Completion schema references unknown function: ${functionName}`);
  }
}
assertUnique('completion.snippets labels', manifest.completion.snippets.map((snippet) => snippet.label));

if (manifest.commands.length < 300) {
  throw new Error(`Expected at least 300 canonical commands, found ${manifest.commands.length}.`);
}

if (!highlighting.backgrounds || !highlighting.foregrounds || !Array.isArray(highlighting.families)) {
  throw new Error('The SPSS highlighting schema is incomplete.');
}
assertUnique('highlighting family ids', highlighting.families.map((family) => family.id));
for (const family of highlighting.families) {
  assertUnique(`highlighting.${family.id}.scopes`, family.scopes);
  for (const variant of ['light', 'dark']) {
    if (!/^#[0-9A-F]{6}$/u.test(family[variant]?.foreground ?? '')) {
      throw new Error(`highlighting.${family.id}.${variant} must define an uppercase hex foreground.`);
    }
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function phrasePattern(value) {
  return value.split(/\s+/u).map(escapeRegex).join('\\s+');
}

function alternation(values) {
  return [...values]
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map(phrasePattern)
    .join('|');
}

const controlCommands = new Set(manifest.controlCommands);
const ordinaryCommands = manifest.commands.filter((command) => !controlCommands.has(command));
const allFunctions = new Set(manifest.functions);
for (const family of manifest.distributionFamilies) {
  for (const distribution of manifest.distributions) {
    allFunctions.add(`${family}.${distribution}`);
  }
}

const corePatterns = [
  { include: '#inline-comment' },
  { include: '#single-string' },
  { include: '#double-string' },
  { include: '#macro-directive' },
  { include: '#macro-variable' },
  { include: '#system-variable' },
  { include: '#scratch-variable' },
  { include: '#known-function' },
  { include: '#function-fallback' },
  { include: '#format' },
  { include: '#missing' },
  { include: '#logical-keyword' },
  { include: '#relational-keyword' },
  { include: '#structural-keyword' },
  { include: '#operator' },
  { include: '#number' },
  { include: '#punctuation' },
  { include: '#ordinary-variable' },
];

const grammar = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: 'IBM SPSS Statistics Syntax',
  scopeName: 'source.spss',
  fileTypes: ['sps'],
  patterns: [
    { include: '#comment-command' },
    { include: '#begin-data' },
    { include: '#begin-python-program' },
    { include: '#begin-program' },
    { include: '#begin-gpl' },
    { include: '#begin-expr' },
    { include: '#matrix-block' },
    { include: '#input-program-block' },
    { include: '#file-type-block' },
    { include: '#macro-definition' },
    { include: '#inline-comment' },
    { include: '#single-string' },
    { include: '#double-string' },
    { include: '#known-control-command' },
    { include: '#known-command' },
    { include: '#generic-command' },
    { include: '#subcommand' },
    ...corePatterns,
  ],
  repository: {
    'comment-command': {
      name: 'comment.line.command.spss',
      begin: '(?i)^\\s*(?:\\*|COMMENT\\b)',
      end: '\\.(?=\\s*$)',
      endCaptures: { 0: { name: 'punctuation.definition.comment.end.spss' } },
    },
    'begin-data': {
      name: 'meta.block.data.spss',
      begin: '(?i)^(\\s*)(BEGIN\\s+DATA)(?:\\.)?\\s*$',
      beginCaptures: { 2: { name: 'keyword.control.spss' } },
      end: '(?i)^(\\s*)(END\\s+DATA)(\\.)(?=\\s*$)',
      endCaptures: {
        2: { name: 'keyword.control.spss' },
        3: { name: 'punctuation.terminator.statement.spss' },
      },
      contentName: 'meta.block.data.content.spss',
    },
    'begin-python-program': {
      name: 'meta.block.program.spss',
      begin: '(?i)^(\\s*)(BEGIN\\s+PROGRAM\\s+PYTHON3)(\\.)(?=\\s*$)',
      beginCaptures: {
        2: { name: 'keyword.control.spss' },
        3: { name: 'punctuation.terminator.statement.spss' },
      },
      end: '(?i)^(\\s*)(END\\s+PROGRAM)(\\.)(?=\\s*$)',
      endCaptures: {
        2: { name: 'keyword.control.spss' },
        3: { name: 'punctuation.terminator.statement.spss' },
      },
      contentName: 'meta.embedded.block.python.spss',
      patterns: [{ include: 'source.python' }],
    },
    'begin-program': {
      name: 'meta.block.program.spss',
      begin: '(?i)^(\\s*)(BEGIN\\s+PROGRAM(?:\\s+[A-Z][A-Z0-9_]*)?)(\\.)(?=\\s*$)',
      beginCaptures: { 2: { name: 'keyword.control.spss' } },
      end: '(?i)^(\\s*)(END\\s+PROGRAM)(\\.)(?=\\s*$)',
      endCaptures: { 2: { name: 'keyword.control.spss' } },
      contentName: 'meta.block.program.content.spss',
    },
    'begin-gpl': {
      name: 'meta.block.gpl.spss',
      begin: '(?i)^(\\s*)(BEGIN\\s+GPL)(\\.)(?=\\s*$)',
      beginCaptures: { 2: { name: 'keyword.control.spss' } },
      end: '(?i)^(\\s*)(END\\s+GPL)(\\.)(?=\\s*$)',
      endCaptures: { 2: { name: 'keyword.control.spss' } },
      contentName: 'meta.block.gpl.content.spss',
    },
    'begin-expr': {
      name: 'meta.block.expression.spss',
      begin: '(?i)^(\\s*)(BEGIN\\s+EXPR)(\\.)(?=\\s*$)',
      beginCaptures: { 2: { name: 'keyword.control.spss' } },
      end: '(?i)^(\\s*)(END\\s+EXPR)(\\.)(?=\\s*$)',
      endCaptures: { 2: { name: 'keyword.control.spss' } },
      patterns: [
        { include: '#known-control-command' },
        { include: '#known-command' },
        { include: '#generic-command' },
        { include: '#subcommand' },
        ...corePatterns,
      ],
    },
    'matrix-block': {
      name: 'meta.block.matrix.spss',
      begin: '(?i)^(\\s*)(MATRIX)(?=\\s|\\.|$)',
      beginCaptures: { 2: { name: 'keyword.control.spss' } },
      end: '(?i)^(\\s*)(END\\s+MATRIX)(\\.)(?=\\s*$)',
      endCaptures: { 2: { name: 'keyword.control.spss' } },
      patterns: [
        { include: '#known-control-command' },
        { include: '#known-command' },
        { include: '#generic-command' },
        { include: '#subcommand' },
        ...corePatterns,
      ],
    },
    'input-program-block': {
      name: 'meta.block.program.spss',
      begin: '(?i)^(\\s*)(INPUT\\s+PROGRAM)(\\.)(?=\\s*$)',
      beginCaptures: { 2: { name: 'keyword.control.spss' } },
      end: '(?i)^(\\s*)(END\\s+INPUT\\s+PROGRAM)(\\.)(?=\\s*$)',
      endCaptures: { 2: { name: 'keyword.control.spss' } },
      patterns: [
        { include: '#known-control-command' },
        { include: '#known-command' },
        { include: '#generic-command' },
        { include: '#subcommand' },
        ...corePatterns,
      ],
    },
    'file-type-block': {
      name: 'meta.block.file-type.spss',
      begin: '(?i)^(\\s*)(FILE\\s+TYPE)(?=\\s|\\.|$)',
      beginCaptures: { 2: { name: 'keyword.control.spss' } },
      end: '(?i)^(\\s*)(END\\s+FILE\\s+TYPE)(\\.)(?=\\s*$)',
      endCaptures: { 2: { name: 'keyword.control.spss' } },
      patterns: [
        { include: '#known-control-command' },
        { include: '#known-command' },
        { include: '#generic-command' },
        { include: '#subcommand' },
        ...corePatterns,
      ],
    },
    'macro-definition': {
      name: 'meta.block.macro.spss',
      begin: '(?i)^(\\s*)(DEFINE)\\b',
      beginCaptures: { 2: { name: 'keyword.control.spss' } },
      end: '(?i)^(\\s*)(!ENDDEFINE)(\\.)(?=\\s*$)',
      endCaptures: {
        2: { name: 'keyword.control.macro.spss' },
        3: { name: 'punctuation.terminator.statement.spss' },
      },
      patterns: [
        { include: '#comment-command' },
        { include: '#inline-comment' },
        { include: '#single-string' },
        { include: '#double-string' },
        { include: '#macro-directive' },
        { include: '#known-control-command' },
        { include: '#known-command' },
        { include: '#subcommand' },
        ...corePatterns,
      ],
    },
    'inline-comment': {
      name: 'comment.block.spss',
      begin: '/\\*',
      beginCaptures: { 0: { name: 'punctuation.definition.comment.begin.spss' } },
      end: '\\*/',
      endCaptures: { 0: { name: 'punctuation.definition.comment.end.spss' } },
    },
    'single-string': {
      name: 'string.quoted.single.spss',
      begin: "'",
      beginCaptures: { 0: { name: 'punctuation.definition.string.begin.spss' } },
      end: "'(?!')",
      endCaptures: { 0: { name: 'punctuation.definition.string.end.spss' } },
      patterns: [{ match: "''", name: 'constant.character.escape.spss' }],
    },
    'double-string': {
      name: 'string.quoted.double.spss',
      begin: '"',
      beginCaptures: { 0: { name: 'punctuation.definition.string.begin.spss' } },
      end: '"(?!")',
      endCaptures: { 0: { name: 'punctuation.definition.string.end.spss' } },
      patterns: [{ match: '""', name: 'constant.character.escape.spss' }],
    },
    'known-control-command': {
      match: `(?i)^(\\s*)(${alternation(manifest.controlCommands)})(?=\\s|\\.|$)`,
      captures: { 2: { name: 'keyword.control.spss' } },
    },
    'known-command': {
      match: `(?i)^(\\s*)(${alternation(ordinaryCommands)})(?=\\s|\\.|$)`,
      captures: { 2: { name: 'keyword.other.command.spss' } },
    },
    'generic-command': {
      match: '(?i)^(\\s*)([A-Z@][A-Z0-9_@#$-]*(?:\\s+[A-Z][A-Z0-9_@#$-]*)?)(?=\\s*(?:/|\\.|$))',
      captures: { 2: { name: 'keyword.other.command.generic.spss' } },
    },
    subcommand: {
      match: '(?i)(^|\\s)(/)([A-Z][A-Z0-9_-]*)',
      captures: {
        2: { name: 'punctuation.definition.subcommand.spss' },
        3: { name: 'keyword.other.subcommand.spss' },
      },
    },
    'macro-directive': {
      match: `(?i)(?<![A-Z0-9_])(${alternation(manifest.macroDirectives)})(?![A-Z0-9_])`,
      captures: { 1: { name: 'keyword.control.macro.spss' } },
    },
    'macro-variable': {
      match: '(?i)![A-Z][A-Z0-9_]*',
      name: 'variable.other.macro.spss',
    },
    'system-variable': {
      match: '(?i)\\$[A-Z][A-Z0-9_]*',
      name: 'variable.language.system.spss',
    },
    'scratch-variable': {
      match: '(?i)#[A-Z@][A-Z0-9_@#$]*(?:\\.[A-Z0-9_@#$]+)*',
      name: 'variable.other.scratch.spss',
    },
    'known-function': {
      match: `(?i)(?<![A-Z0-9_@#$])(${alternation([...allFunctions])}(?:\\.(\\d+))?)(?=\\s*\\()`,
      captures: {
        1: { name: 'support.function.spss' },
        2: { name: 'constant.numeric.function-modifier.spss' },
      },
    },
    'function-fallback': {
      match: '(?i)(?<![A-Z0-9_@#$])([A-Z@#$][A-Z0-9_@#$]*(?:\\.(?:[A-Z][A-Z0-9_@#$]*|\\d+))*)(?=\\s*\\()',
      captures: { 1: { name: 'support.function.spss' } },
    },
    format: {
      match: `(?i)(?<![A-Z0-9_@#$])(?:${alternation(manifest.formats)})\\d+(?:\\.\\d+)?(?![A-Z0-9_@#$])`,
      name: 'support.type.format.spss',
    },
    missing: {
      patterns: [
        { match: '(?i)(?<![A-Z0-9_@#$])(?:SYSMIS|MISSING|LO|HI|THRU)(?![A-Z0-9_@#$])', name: 'constant.language.missing.spss' },
        { match: '(?<![A-Z0-9_@#$])\\.(?![A-Z0-9_@#$]|\\s*$)', name: 'constant.language.missing.spss' },
      ],
    },
    'logical-keyword': {
      match: '(?i)(?<![A-Z0-9_@#$])(?:AND|OR|NOT)(?![A-Z0-9_@#$])',
      name: 'keyword.operator.logical.spss',
    },
    'relational-keyword': {
      match: '(?i)(?<![A-Z0-9_@#$])(?:EQ|NE|LT|LE|GT|GE)(?![A-Z0-9_@#$])',
      name: 'keyword.operator.relational.spss',
    },
    'structural-keyword': {
      match: `(?i)(?<![A-Z0-9_@#$])(?:${alternation([...manifest.reservedKeywords, ...manifest.structuralKeywords].filter((value) => !['AND', 'OR', 'NOT', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE'].includes(value))) })(?![A-Z0-9_@#$])`,
      name: 'keyword.other.spss',
    },
    operator: {
      patterns: [
        { match: '<=|>=|~=|<>|=|<|>', name: 'keyword.operator.relational.spss' },
        { match: '[&|~]', name: 'keyword.operator.logical.spss' },
        { match: '\\*\\*|[+*/-]', name: 'keyword.operator.arithmetic.spss' },
      ],
    },
    number: {
      match: '(?<![A-Z0-9_@#$])(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[Ee][+-]?\\d+)?(?![A-Z0-9_@#$])',
      name: 'constant.numeric.spss',
    },
    punctuation: {
      patterns: [
        { match: '\\.(?=\\s*$)', name: 'punctuation.terminator.statement.spss' },
        { match: '[(),]', name: 'punctuation.separator.spss' },
        { match: '[\\[\\]]', name: 'punctuation.section.brackets.spss' },
      ],
    },
    'ordinary-variable': {
      match: '(?i)(?<![A-Z0-9_@#$])[A-Z@][A-Z0-9_@#$]*(?:\\.[A-Z0-9_@#$]+)*(?![A-Z0-9_@#$])',
      name: 'variable.other.spss',
    },
  },
};

const rendered = `${JSON.stringify(grammar, null, 2)}\n`;
const webviewSyntax = {
  commands: manifest.commands,
  controlCommands: manifest.controlCommands,
  subcommands: manifest.subcommands,
  functions: [...allFunctions].sort(),
  formats: manifest.formats,
  macroDirectives: manifest.macroDirectives,
  reservedKeywords: manifest.reservedKeywords,
  structuralKeywords: manifest.structuralKeywords,
  completionKeywords: manifest.completion.keywords,
  systemVariables: manifest.systemVariables,
  tokenFamilies: highlighting.families.map((family) => family.id),
  palettes: {
    light: Object.fromEntries(highlighting.families.map((family) => [family.id, family.light])),
    dark: Object.fromEntries(highlighting.families.map((family) => [family.id, family.dark])),
  },
};
const renderedWebviewSyntax = `(() => {\n  'use strict';\n  window.SPSS_SYNTAX_DATA = ${JSON.stringify(webviewSyntax, null, 2)};\n})();\n`;
const cssVariables = (variant) => highlighting.families
  .map((family) => `  --spss-${family.id}-foreground: ${family[variant].foreground};`)
  .join('\n');
const cssRules = highlighting.families.map((family) => {
  const fontStyle = family.light.fontStyle ?? family.dark.fontStyle ?? '';
  const italic = fontStyle.split(/\s+/u).includes('italic') ? 'italic' : 'normal';
  const weight = fontStyle.split(/\s+/u).includes('bold') ? '600' : '400';
  return `.syntax-token.${family.id} {\n  color: var(--spss-${family.id}-foreground);\n  font-style: ${italic};\n  font-weight: ${weight};\n}`;
}).join('\n\n');
const renderedWebviewTheme = `:root,\n+body.vscode-light,\n+body.vscode-high-contrast-light {\n+${cssVariables('light')}\n+}\n+\n+body.vscode-dark,\n+body.vscode-high-contrast {\n+${cssVariables('dark')}\n+}\n+\n+${cssRules}\n+`;
const coverage = `# SPSS Syntax Coverage

> This file is generated from \`syntax/spss-language.json\`. Do not maintain a second command list here.

## Baseline

- Lexical baseline: IBM SPSS Statistics 25 Command Syntax.
- Canonical top-level inventory: ${manifest.commands.length} entries, listed below.
- Execution is not restricted to this inventory. The installed IBM SPSS Statistics processor decides whether later-version or Extension Command syntax is valid.
- Matching is case-insensitive; source spelling and string contents are preserved.

## Universal lexical coverage

The generated TextMate Grammar handles command-start recognition, multiline commands, generic unknown commands, generic \`/SUBCOMMAND\`, single and double quoted strings, three comment forms, numeric constants, arithmetic/relational/logical operators, SPSS formats, ordinary/scratch/system variables, dotted functions, minimum-valid-count modifiers, and command terminators.

The Chat code-block highlighter receives generated vocabulary from this same manifest. Automated parity tests cover every canonical command plus the shared subcommand, function, format, macro-directive, and system-variable inventories.

Dedicated block scopes cover BEGIN DATA, BEGIN PROGRAM, BEGIN GPL, BEGIN EXPR, MATRIX, INPUT PROGRAM, FILE TYPE, and DEFINE. BEGIN PROGRAM PYTHON3 uses an embedded Python scope when available. BEGIN DATA content remains raw data and is not tokenized as ordinary SPSS commands.

## Completion schema

The same manifest supplies deterministic command completion, ${Object.keys(manifest.completion.commandSubcommands).length} command-specific subcommand vocabularies, ${manifest.completion.keywords.length} contextual keywords, ${Object.keys(manifest.completion.functionSnippets).length} verified function snippets, and ${manifest.completion.snippets.length} verified command snippets. Variable completion is supplied separately by the current Active Dataset cache and is never written into this static schema.

## Macro coverage

Known macro directives are highlighted as \`keyword.control.macro.spss\`; future or user-defined \`!name\` tokens fall back to \`variable.other.macro.spss\`. DEFINE and !ENDDEFINE require their full canonical spellings.

Known directives: ${manifest.macroDirectives.join(', ')}.

## Function-family handling

The manifest includes the documented core functions and the ${manifest.distributionFamilies.join(', ')} distribution families over ${manifest.distributions.join(', ')}. Any syntactically valid identifier, dotted identifier, or dotted numeric modifier immediately followed by \`(\` receives function fallback highlighting, so later-version and extension functions remain usable.

## Forward compatibility

Unknown command-start identifiers receive \`keyword.other.command.generic.spss\`; unknown slash-prefixed subcommands receive \`keyword.other.subcommand.spss\`. No highlighter decision blocks execution.

## Complete canonical v25 command inventory

\`\`\`text
${manifest.commands.join('\n')}
\`\`\`
`;

function renderTheme(variant) {
  const name = variant === 'light' ? 'SPSS Studio Light' : 'SPSS Studio Dark';
  return `${JSON.stringify({
    $schema: 'vscode://schemas/color-theme',
    name,
    type: variant,
    semanticHighlighting: true,
    colors: {
      'editor.background': highlighting.backgrounds[variant],
      'editor.foreground': highlighting.foregrounds[variant],
    },
    tokenColors: highlighting.families.map((family) => ({
      name: `SPSS ${family.id}`,
      scope: family.scopes,
      settings: family[variant],
    })),
  }, null, 2)}\n`;
}

const renderedLightTheme = renderTheme('light');
const renderedDarkTheme = renderTheme('dark');

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(grammarPath) ? fs.readFileSync(grammarPath, 'utf8') : '';
  const existingCoverage = fs.existsSync(coveragePath) ? fs.readFileSync(coveragePath, 'utf8') : '';
  const existingWebviewSyntax = fs.existsSync(webviewSyntaxPath)
    ? fs.readFileSync(webviewSyntaxPath, 'utf8')
    : '';
  const existingWebviewTheme = fs.existsSync(webviewThemePath)
    ? fs.readFileSync(webviewThemePath, 'utf8')
    : '';
  const existingLightTheme = fs.existsSync(lightThemePath) ? fs.readFileSync(lightThemePath, 'utf8') : '';
  const existingDarkTheme = fs.existsSync(darkThemePath) ? fs.readFileSync(darkThemePath, 'utf8') : '';
  if (
    existing !== rendered
    || existingCoverage !== coverage
    || existingWebviewSyntax !== renderedWebviewSyntax
    || existingWebviewTheme !== renderedWebviewTheme
    || existingLightTheme !== renderedLightTheme
    || existingDarkTheme !== renderedDarkTheme
  ) {
    process.stderr.write('Generated TextMate grammar, Chat syntax data, themes, or syntax coverage is missing or stale. Run npm run generate:grammar.\n');
    process.exitCode = 1;
  }
} else {
  fs.mkdirSync(path.dirname(grammarPath), { recursive: true });
  fs.mkdirSync(path.dirname(coveragePath), { recursive: true });
  fs.mkdirSync(path.dirname(webviewSyntaxPath), { recursive: true });
  fs.mkdirSync(path.dirname(lightThemePath), { recursive: true });
  fs.writeFileSync(grammarPath, rendered, 'utf8');
  fs.writeFileSync(coveragePath, coverage, 'utf8');
  fs.writeFileSync(webviewSyntaxPath, renderedWebviewSyntax, 'utf8');
  fs.writeFileSync(webviewThemePath, renderedWebviewTheme, 'utf8');
  fs.writeFileSync(lightThemePath, renderedLightTheme, 'utf8');
  fs.writeFileSync(darkThemePath, renderedDarkTheme, 'utf8');
  process.stdout.write(`Generated ${path.relative(projectRoot, grammarPath)}, ${path.relative(projectRoot, webviewSyntaxPath)}, both SPSS Studio themes, and ${path.relative(projectRoot, coveragePath)} from ${manifest.commands.length} canonical commands.\n`);
}
