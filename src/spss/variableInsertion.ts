import type { SpssVariableMetadata } from './types';

export function cachedVariableName(
  variables: readonly SpssVariableMetadata[],
  candidate: unknown,
): string | undefined {
  if (typeof candidate !== 'string') {
    return undefined;
  }
  return variables.find((variable) => variable.name === candidate)?.name;
}
