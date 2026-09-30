import fs from 'node:fs';
import path from 'node:path';

export interface SpssSnippetDefinition {
  label: string;
  body: string;
  description: string;
}

export interface SpssCompletionSchema {
  keywords: string[];
  commandSubcommands: Record<string, string[]>;
  functionSnippets: Record<string, string>;
  snippets: SpssSnippetDefinition[];
}

export interface SpssLanguageSchema {
  baseline: string;
  commands: string[];
  controlCommands: string[];
  reservedKeywords: string[];
  structuralKeywords: string[];
  subcommands: string[];
  functions: string[];
  distributionFamilies: string[];
  distributions: string[];
  formats: string[];
  macroDirectives: string[];
  systemVariables: string[];
  completion: SpssCompletionSchema;
}

function isLanguageSchema(value: unknown): value is SpssLanguageSchema {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<SpssLanguageSchema>;
  return Array.isArray(candidate.commands)
    && Array.isArray(candidate.functions)
    && Array.isArray(candidate.subcommands)
    && typeof candidate.completion === 'object'
    && Array.isArray(candidate.completion.keywords)
    && Array.isArray(candidate.completion.snippets);
}

export function loadLanguageSchema(extensionRoot: string): SpssLanguageSchema {
  const schemaPath = path.join(extensionRoot, 'syntax', 'spss-language.json');
  const parsed: unknown = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  if (!isLanguageSchema(parsed)) {
    throw new Error(`Invalid SPSS language schema: ${schemaPath}`);
  }
  return parsed;
}

export function allSchemaFunctions(schema: SpssLanguageSchema): string[] {
  const functions = new Set(schema.functions);
  for (const family of schema.distributionFamilies) {
    for (const distribution of schema.distributions) {
      functions.add(`${family}.${distribution}`);
    }
  }
  return [...functions];
}
