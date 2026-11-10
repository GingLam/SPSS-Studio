import * as vscode from 'vscode';
import type { VariableCache } from '../spss/variableCache';
import { declaredVariablesBefore } from './codingCompletion';
import { analyzeCompletionContext } from './completionContext';
import { getCompletionCandidates, type CompletionCandidateKind } from './completionEngine';
import type { RenderedTemplate } from './completionTemplates';
import type { SpssLanguageSchema } from './languageSchema';

const kinds: Record<CompletionCandidateKind, vscode.CompletionItemKind> = {
  command: vscode.CompletionItemKind.Keyword,
  subcommand: vscode.CompletionItemKind.Property,
  keyword: vscode.CompletionItemKind.Keyword,
  function: vscode.CompletionItemKind.Function,
  snippet: vscode.CompletionItemKind.Snippet,
  variable: vscode.CompletionItemKind.Variable,
  macro: vscode.CompletionItemKind.Keyword,
};

export class SpssCompletionProvider implements vscode.CompletionItemProvider {
  private manualRequest: { uri: string; version: number; offset: number; expiresAt: number } | undefined;

  public constructor(
    private readonly schema: SpssLanguageSchema,
    private readonly variableCache: VariableCache,
    private readonly onTemplateAccepted?: (document: vscode.TextDocument, start: number, template: RenderedTemplate) => vscode.Command,

  ) {}

  public prepareManualCompletion(document: vscode.TextDocument, position: vscode.Position): void {
    this.manualRequest = document.languageId === 'spss' && !document.isClosed ? {
      uri: document.uri.toString(), version: document.version,
      offset: document.offsetAt(position), expiresAt: Date.now() + 5000,
    } : undefined;
  }

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): vscode.CompletionList {
    const request = this.manualRequest;
    this.manualRequest = undefined;
    if (token?.isCancellationRequested || document.languageId !== 'spss') { return new vscode.CompletionList([], false); }
    const offset = document.offsetAt(position);
    const manual = request && request.uri === document.uri.toString() && request.version === document.version
      && request.offset === offset && request.expiresAt > Date.now();
    const source = document.getText();
    const context = analyzeCompletionContext(source, offset, this.schema);
    const cached = this.variableCache.variables;
    const local = context.prefix && ['VARIABLE_LIST', 'EXPRESSION', 'FUNCTION_ARGUMENT', 'UNKNOWN'].includes(context.kind)
      ? declaredVariablesBefore(source, offset, this.schema) : [];
    const names = new Set(cached.map(({ name }) => name.toUpperCase()));
    const variables = [...cached, ...local.filter(({ name }) => !names.has(name.toUpperCase()))];
    const candidates = getCompletionCandidates(context, this.schema, variables,
      manual ? 'manual' : 'automatic', vscode.env.language.startsWith('zh'));
    const suffix = document.lineAt(position.line).text.slice(position.character);
    if (/^[\p{L}\p{M}\p{N}_@#$]/u.test(suffix)) return new vscode.CompletionList([], false);
    const range = new vscode.Range(document.positionAt(context.replaceStart), position);
    const items = candidates.map((candidate, index) => {
      const item = new vscode.CompletionItem({ label: candidate.label, description: 'SPSS Studio' }, kinds[candidate.kind]);
      const followsFunction = candidate.kind === 'function'
        && /^(?:[),+*/<>=-]|\.(?![\p{L}\p{M}\p{N}_@#$]))/u.test(suffix.trimStart());
      const template = !suffix.trim() || followsFunction ? candidate.template : undefined;
      item.insertText = template ? new vscode.SnippetString(template.snippet) : candidate.filterText
        ?? (candidate.template ? candidate.label : candidate.insertText);
      if (template) item.keepWhitespace = true;
      if (template?.slots.length && this.onTemplateAccepted) {
        item.command = this.onTemplateAccepted(document, context.replaceStart, template);
      }
      item.range = range;
      item.sortText = candidate.sortText;
      item.preselect = index === 0;
      item.commitCharacters = [];
      item.filterText = candidate.filterText ?? (candidate.kind === 'subcommand' ? candidate.label.slice(1) : candidate.label);
      item.detail = `SPSS Studio · ${template?.preview ?? candidate.detail ?? candidate.kind}`;
      if (candidate.documentation) {
        item.documentation = new vscode.MarkdownString(candidate.documentation);
      }
      return item;
    });
    return new vscode.CompletionList(items, false);
  }
}
