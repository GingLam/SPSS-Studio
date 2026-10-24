import * as vscode from 'vscode';
import type { SpssEditorTargetTracker } from '../editor/spssEditorTargetTracker';
import { cachedVariableName, orderedCachedVariableNames } from '../spss/variableInsertion';
import type { VariableCache } from '../spss/variableCache';
import { runtimeStringsForLanguage } from '../localization/runtimeStrings';

const strings = runtimeStringsForLanguage(vscode.env.language);

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
    void vscode.window.showWarningMessage(strings.insertRequiresEditor);
  }
}

export async function insertCachedVariable(
  dependencies: VariableCommandDependencies,
  variableName: unknown,
): Promise<void> {
  const validatedName = cachedVariableName(dependencies.variableCache.variables, variableName);
  if (!validatedName) {
    void vscode.window.showWarningMessage(
      strings.variableUnavailable,
    );
    return;
  }
  await insertVariable(dependencies, validatedName);
}

export async function insertCachedVariables(
  dependencies: VariableCommandDependencies,
  values: unknown,
): Promise<void> {
  const names = orderedCachedVariableNames(dependencies.variableCache.variables, values);
  if (!names) {
    void vscode.window.showWarningMessage(
      strings.selectedVariablesUnavailable,
    );
    return;
  }
  await insertVariable(dependencies, names.join(' '));
}

export async function copyCachedVariables(
  variableCache: VariableCache,
  values: unknown,
): Promise<void> {
  const names = orderedCachedVariableNames(variableCache.variables, values);
  if (!names) {
    void vscode.window.showWarningMessage(
      strings.selectedVariablesUnavailable,
    );
    return;
  }
  await vscode.env.clipboard.writeText(names.join(' '));
}
