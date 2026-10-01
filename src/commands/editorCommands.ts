import * as vscode from 'vscode';

export async function undoLastEdit(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'spss') {
    void vscode.window.showInformationMessage('Open an SPSS Syntax (.sps) editor first.');
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
