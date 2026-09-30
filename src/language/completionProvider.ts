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
  public constructor(
    private readonly schema: SpssLanguageSchema,
    private readonly variableCache: VariableCache,
  ) {}

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionList {
    const offset = document.offsetAt(position);
    const context = analyzeCompletionContext(document.getText(), offset, this.schema);
    const candidates = getCompletionCandidates(context, this.schema, this.variableCache.variables);
    const range = new vscode.Range(document.positionAt(context.replaceStart), position);
    const items = candidates.map((candidate) => {
      const item = new vscode.CompletionItem(candidate.label, kinds[candidate.kind]);
      item.insertText = candidate.snippet
        ? new vscode.SnippetString(candidate.insertText)
        : candidate.insertText;
      item.range = range;
      item.sortText = candidate.sortText;
      item.filterText = candidate.kind === 'subcommand' ? candidate.label.slice(1) : candidate.label;
      if (candidate.detail) {
        item.detail = candidate.detail;
      }
      if (candidate.documentation) {
        item.documentation = new vscode.MarkdownString(candidate.documentation);
      }
      return item;
    });
    return new vscode.CompletionList(items, false);
  }
}
