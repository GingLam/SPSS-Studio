import * as vscode from 'vscode';

export async function requireTrustedWorkspace(): Promise<boolean> {
  if (vscode.workspace.isTrusted) {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(
    'Running SPSS Syntax executes code and is disabled in an untrusted workspace.',
    'Manage Workspace Trust',
  );
  if (choice === 'Manage Workspace Trust') {
    await vscode.commands.executeCommand('workbench.trust.manage');
  }
  return false;
}
