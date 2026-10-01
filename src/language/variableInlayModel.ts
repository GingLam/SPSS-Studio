import type { SpssVariableMetadata } from '../spss/types';

export const VARIABLE_INLAY_LIMIT = 50;

export interface VariableInlayEntry {
  name: string;
  tooltip: string;
}

export interface VariableInlayModel {
  variables: VariableInlayEntry[];
  hasMore: boolean;
  total: number;
}

export function buildVariableInlayModel(
  variables: readonly SpssVariableMetadata[],
): VariableInlayModel {
  return {
    variables: variables.slice(0, VARIABLE_INLAY_LIMIT).map((variable) => ({
      name: variable.name,
      tooltip: variable.label || 'No label',
    })),
    hasMore: variables.length > VARIABLE_INLAY_LIMIT,
    total: variables.length,
  };
}
