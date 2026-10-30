import * as vscode from 'vscode';
import { runtimeStringsForLanguage } from '../localization/runtimeStrings';

const strings = runtimeStringsForLanguage(vscode.env.language);

export async function newSpssFile(showStudio: () => void): Promise<void> {
  // An unassociated untitled document avoids creating or overwriting a disk file.
  const document = await vscode.workspace.openTextDocument({ language: 'spss', content: '' });
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One, preview: false, preserveFocus: false,
  });
  showStudio();
}

export async function undoLastEdit(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'spss') {
    void vscode.window.showInformationMessage(strings.openSpssEditor);
    return;
  }
  const options: vscode.TextDocumentShowOptions = {
    preserveFocus: false,
    preview: false,
  };
  if (editor.viewColumn !== undefined) {
    options.viewColumn = editor.viewColumn;
  }
  const focusedEditor = await vscode.window.showTextDocument(editor.document, options);
  focusedEditor.selection = editor.selection;
  await vscode.commands.executeCommand('undo');
}
