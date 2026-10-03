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

export function orderedCachedVariableNames(
  variables: readonly SpssVariableMetadata[],
  values: unknown,
): string[] | undefined {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }
  const requested = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || !value) {
      return undefined;
    }
    requested.add(value);
  }
  const ordered = variables.filter((variable) => requested.has(variable.name)).map((variable) => variable.name);
  return ordered.length === requested.size ? ordered : undefined;
}
