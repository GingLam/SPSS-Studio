export const QUICK_START_LAST_VERSION_KEY = 'quickStart.lastObservedVersion';
export const QUICK_START_SUPPRESS_UPDATES_KEY = 'quickStart.suppressAfterUpdates';

export type QuickStartLanguage = 'en' | 'zh-cn';

export interface QuickStartDisplayState {
  lastObservedVersion?: string;
  suppressAfterUpdates: boolean;
}

export function quickStartLanguage(uiLanguage: string): QuickStartLanguage {
  return uiLanguage.trim().toLowerCase().startsWith('zh') ? 'zh-cn' : 'en';
}

export function shouldShowQuickStart(
  currentVersion: string,
  state: QuickStartDisplayState,
): boolean {
  if (!state.lastObservedVersion) {
    return true;
  }
  return state.lastObservedVersion !== currentVersion && !state.suppressAfterUpdates;
}

export function extensionVersion(packageJson: unknown): string {
  if (
    typeof packageJson === 'object'
    && packageJson !== null
    && 'version' in packageJson
    && typeof packageJson.version === 'string'
    && packageJson.version.trim().length > 0
  ) {
    return packageJson.version;
  }
  throw new Error('SPSS Studio package version is unavailable.');
}

export interface SetSuppressAfterUpdatesMessage {
  type: 'setSuppressAfterUpdates';
  value: boolean;
}

export function isQuickStartMessage(value: unknown): value is SetSuppressAfterUpdatesMessage {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'setSuppressAfterUpdates'
    && 'value' in value
    && typeof value.value === 'boolean';
}
