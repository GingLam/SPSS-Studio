import * as vscode from 'vscode';

export async function undoLastEdit(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'spss') {
    void vscode.window.showInformationMessage('Open an SPSS Syntax (.sps) editor first.');
    return;
  }
  await vscode.commands.executeCommand('undo');
}
