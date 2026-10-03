import * as vscode from 'vscode';

interface SpssEditorTarget {
  uri: vscode.Uri;
  viewColumn: vscode.ViewColumn | undefined;
  selections: readonly vscode.Selection[];
  documentVersion: number;
}

export class SpssEditorTargetTracker implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[];
  private target: SpssEditorTarget | undefined;

  public constructor() {
    this.capture(vscode.window.activeTextEditor);
    this.subscriptions = [
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.capture(editor);
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        this.capture(event.textEditor);
      }),
    ];
  }

  public get hasTarget(): boolean {
    return this.isSpssEditor(vscode.window.activeTextEditor) || this.target !== undefined;
  }

  public async insert(text: string): Promise<boolean> {
    const active = vscode.window.activeTextEditor;
    let editor: vscode.TextEditor | undefined;
    let selections: readonly vscode.Selection[] | undefined;
    if (this.isSpssEditor(active)) {
      editor = active;
      selections = active.selections;
    } else if (this.target) {
      try {
        const document = await vscode.workspace.openTextDocument(this.target.uri);
        if (document.languageId !== 'spss') {
          return false;
        }
        const options: vscode.TextDocumentShowOptions = {
          preserveFocus: false,
          preview: false,
        };
        if (this.target.viewColumn !== undefined) {
          options.viewColumn = this.target.viewColumn;
        }
        editor = await vscode.window.showTextDocument(document, options);
        selections = this.target.selections.map((selection) => this.validSelection(document, selection));
      } catch {
        return false;
      }
    }
    if (!editor || !selections || selections.length === 0) {
      return false;
    }

    const replacements = selections.map((selection, index) => ({
      index,
      selection,
      startOffset: editor.document.offsetAt(selection.start),
      endOffset: editor.document.offsetAt(selection.end),
    })).sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset);
    const cursorOffsets = new Array<number>(replacements.length);
    let offsetDelta = 0;
    for (const replacement of replacements) {
      cursorOffsets[replacement.index] = replacement.startOffset + offsetDelta + text.length;
      offsetDelta += text.length - (replacement.endOffset - replacement.startOffset);
    }
    const applied = await editor.edit((builder) => {
      for (const replacement of replacements) {
        builder.replace(replacement.selection, text);
      }
    });
    if (!applied) {
      return false;
    }
    editor.selections = cursorOffsets.map((offset) => {
      const end = editor.document.positionAt(offset);
      return new vscode.Selection(end, end);
    });
    this.capture(editor);
    return true;
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private capture(editor: vscode.TextEditor | undefined): void {
    if (!this.isSpssEditor(editor)) {
      return;
    }
    this.target = {
      uri: editor.document.uri,
      viewColumn: editor.viewColumn,
      selections: [...editor.selections],
      documentVersion: editor.document.version,
    };
  }

  private isSpssEditor(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
    return editor?.document.languageId === 'spss';
  }

  private validSelection(document: vscode.TextDocument, selection: vscode.Selection): vscode.Selection {
    const anchor = document.positionAt(document.offsetAt(selection.anchor));
    const active = document.positionAt(document.offsetAt(selection.active));
    return new vscode.Selection(anchor, active);
  }
}
