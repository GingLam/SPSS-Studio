import * as vscode from 'vscode';
import type { SpssEditorTargetTracker } from '../editor/spssEditorTargetTracker';
import { cachedVariableName } from '../spss/variableInsertion';
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

export async function insertCachedVariable(
  dependencies: VariableCommandDependencies,
  variableName: unknown,
): Promise<void> {
  const validatedName = cachedVariableName(dependencies.variableCache.variables, variableName);
  if (!validatedName) {
    void vscode.window.showWarningMessage(
      'That variable is no longer available in the current Active Dataset.',
    );
    return;
  }
  await insertVariable(dependencies, validatedName);
}
