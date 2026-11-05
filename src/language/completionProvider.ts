import * as vscode from 'vscode';
import type { VariableCache } from '../spss/variableCache';
import { analyzeCompletionContext } from './completionContext';
import { getCompletionCandidates, type CompletionCandidateKind } from './completionEngine';
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
    const context = analyzeCompletionContext(document.getText(), offset, this.schema);
    const candidates = getCompletionCandidates(context, this.schema, this.variableCache.variables, manual ? 'manual' : 'automatic');
    const range = new vscode.Range(document.positionAt(context.replaceStart), position);
    const items = candidates.map((candidate) => {
      const item = new vscode.CompletionItem({ label: candidate.label, description: 'SPSS Studio' }, kinds[candidate.kind]);
      item.insertText = candidate.snippet
        ? new vscode.SnippetString(candidate.insertText)
        : candidate.insertText;
      item.range = range;
      item.sortText = candidate.sortText;
      item.preselect = false;
      item.commitCharacters = [];
      item.filterText = candidate.kind === 'subcommand' ? candidate.label.slice(1) : candidate.label;
      item.detail = `SPSS Studio · ${candidate.detail ?? candidate.kind}`;
      if (candidate.documentation) {
        item.documentation = new vscode.MarkdownString(candidate.documentation);
      }
      return item;
    });
    return new vscode.CompletionList(items, false);
  }
}
