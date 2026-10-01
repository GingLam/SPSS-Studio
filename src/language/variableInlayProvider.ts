import * as vscode from 'vscode';
import type { VariableCache } from '../spss/variableCache';
import { buildVariableInlayModel } from './variableInlayModel';

export class SpssVariableInlayProvider implements vscode.InlayHintsProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly cacheSubscription: { dispose: () => void };

  public readonly onDidChangeInlayHints = this.emitter.event;

  public constructor(private readonly cache: VariableCache) {
    this.cacheSubscription = cache.onDidChange(() => {
      this.emitter.fire();
    });
  }

  public provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    const firstPosition = new vscode.Position(0, 0);
    if (document.languageId !== 'spss' || !range.contains(firstPosition)) {
      return [];
    }
    const model = buildVariableInlayModel(this.cache.variables);
    if (model.variables.length === 0) {
      return [];
    }

    const parts: vscode.InlayHintLabelPart[] = [];
    for (const [index, variable] of model.variables.entries()) {
      if (index > 0) {
        parts.push(new vscode.InlayHintLabelPart('  '));
      }
      const part = new vscode.InlayHintLabelPart(variable.name);
      part.tooltip = variable.tooltip;
      part.command = {
        command: 'spssStudio.insertVariable',
        title: `Insert ${variable.name}`,
        arguments: [variable.name],
      };
      parts.push(part);
    }
    if (model.hasMore) {
      parts.push(new vscode.InlayHintLabelPart('  '));
      const more = new vscode.InlayHintLabelPart('More Variables…');
      more.tooltip = `Search all ${String(model.total)} Active Dataset variables`;
      more.command = {
        command: 'spssStudio.showVariablePicker',
        title: 'Show All SPSS Variables',
      };
      parts.push(more);
    }

    const hint = new vscode.InlayHint(firstPosition, parts);
    hint.paddingLeft = true;
    hint.paddingRight = true;
    return [hint];
  }

  public dispose(): void {
    this.cacheSubscription.dispose();
    this.emitter.dispose();
  }
}
