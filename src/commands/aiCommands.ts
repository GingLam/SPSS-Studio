import * as vscode from 'vscode';
import type { AiResponseLanguage } from '../ai/chatProtocol';
import { buildSyntaxExplanationQuestion } from '../ai/syntaxExplanation';
import { findCurrentCommand } from '../spss/commandScanner';

export interface AiSyntaxCommandDependencies {
  showChat: () => void;
  sendQuestion: (question: string) => Promise<void>;
  responseLanguage: () => AiResponseLanguage;
}

function activeSpssEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open an SPSS Syntax (.sps) editor first.');
    return undefined;
  }
  if (editor.document.languageId !== 'spss') {
    void vscode.window.showInformationMessage('The active editor is not an SPSS Syntax document.');
    return undefined;
  }
  return editor;
}

export async function explainSelectionOrCurrentCommand(
  dependencies: AiSyntaxCommandDependencies,
): Promise<void> {
  const editor = activeSpssEditor();
  if (!editor) {
    return;
  }

  let syntax: string;
  if (!editor.selection.isEmpty) {
    syntax = editor.document.getText(editor.selection);
    if (!syntax.trim()) {
      void vscode.window.showInformationMessage('The selected SPSS Syntax is empty.');
      return;
    }
  } else {
    const documentText = editor.document.getText();
    const offset = editor.document.offsetAt(editor.selection.active);
    const current = findCurrentCommand(documentText, offset);
    if (current.kind === 'none') {
      const message = current.reason === 'comment'
        ? 'The cursor is inside an SPSS command comment.'
        : 'No SPSS command exists at the cursor position.';
      void vscode.window.showInformationMessage(message);
      return;
    }
    syntax = current.text;
  }

  const question = buildSyntaxExplanationQuestion(syntax, dependencies.responseLanguage());
  dependencies.showChat();
  await dependencies.sendQuestion(question);
}
