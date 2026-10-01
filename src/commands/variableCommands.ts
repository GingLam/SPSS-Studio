import * as vscode from 'vscode';
import type { SpssEditorTargetTracker } from '../editor/spssEditorTargetTracker';
import type { VariableCache } from '../spss/variableCache';

export interface VariableCommandDependencies {
  variableCache: VariableCache;
  editorTarget: SpssEditorTargetTracker;
}

export async function insertVariable(
  dependencies: VariableCommandDependencies,
  variableName: unknown,
): Promise<void> {
  if (typeof variableName !== 'string' || variableName.length === 0) {
    return;
  }
  if (!await dependencies.editorTarget.insert(variableName)) {
    void vscode.window.showWarningMessage('Open an SPSS syntax editor before inserting a variable.');
  }
}

export async function showVariablePicker(
  dependencies: VariableCommandDependencies,
): Promise<void> {
  const variables = dependencies.variableCache.variables;
  if (variables.length === 0) {
    void vscode.window.showInformationMessage('No Active Dataset variables are available. Run syntax that creates or opens a dataset first.');
    return;
  }
  const selected = await vscode.window.showQuickPick(
    variables.map((variable) => ({
      label: variable.name,
      description: variable.label || 'No label',
      variableName: variable.name,
    })),
    {
      title: 'SPSS Active Dataset Variables',
      placeHolder: 'Search by variable name or label',
      matchOnDescription: true,
    },
  );
  if (selected) {
    await insertVariable(dependencies, selected.variableName);
  }
}
