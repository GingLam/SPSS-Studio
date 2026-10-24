import * as vscode from 'vscode';
import { findCurrentCommand } from '../spss/commandScanner';
import type { StudioSession } from '../studioSession';
import { requireTrustedWorkspace } from './workspaceTrust';
import { runtimeStringsForLanguage } from '../localization/runtimeStrings';

const strings = runtimeStringsForLanguage(vscode.env.language);

export interface ExecutionCommandDependencies {
  studio: StudioSession;
}

async function executeSyntax(
  dependencies: ExecutionCommandDependencies,
  syntax: string,
  label: string,
): Promise<void> {
  if (!(await requireTrustedWorkspace())) {
    return;
  }
  await dependencies.studio.execute(syntax, label);
}

function activeSpssEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage(strings.openSpssEditor);
    return undefined;
  }
  if (editor.document.languageId !== 'spss') {
    void vscode.window.showInformationMessage(strings.activeEditorNotSpss);
    return undefined;
  }
  return editor;
}

export async function runSelectionOrCurrentCommand(
  dependencies: ExecutionCommandDependencies,
): Promise<void> {
  const editor = activeSpssEditor();
  if (!editor) {
    return;
  }
  if (!editor.selection.isEmpty) {
    const selectionText = editor.document.getText(editor.selection);
    await executeSyntax(dependencies, selectionText, 'Run Selection');
    return;
  }

  const documentText = editor.document.getText();
  const offset = editor.document.offsetAt(editor.selection.active);
  const current = findCurrentCommand(documentText, offset);
  if (current.kind === 'none') {
    const message = current.reason === 'comment'
      ? strings.cursorInComment
      : strings.noCommandAtCursor;
    void vscode.window.showInformationMessage(message);
    return;
  }
  await executeSyntax(dependencies, current.text, 'Run Current Command');
}

export async function runFile(dependencies: ExecutionCommandDependencies): Promise<void> {
  const editor = activeSpssEditor();
  if (!editor) {
    return;
  }
  await executeSyntax(dependencies, editor.document.getText(), 'Run File');
}
