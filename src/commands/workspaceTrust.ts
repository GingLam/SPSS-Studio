import * as vscode from 'vscode';
import { runtimeStringsForLanguage } from '../localization/runtimeStrings';

export async function requireTrustedWorkspace(): Promise<boolean> {
  if (vscode.workspace.isTrusted) {
    return true;
  }
  const strings = runtimeStringsForLanguage(vscode.env.language);
  const choice = await vscode.window.showWarningMessage(
    strings.untrustedExecution,
    strings.manageWorkspaceTrust,
  );
  if (choice === strings.manageWorkspaceTrust) {
    await vscode.commands.executeCommand('workbench.trust.manage');
  }
  return false;
}
