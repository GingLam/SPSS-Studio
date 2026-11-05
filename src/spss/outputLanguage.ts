import type { SpssOutputLanguage } from './types';

/** Resolve native SPSS output from the VS Code display language only. */
export function nativeOutputLanguage(uiLanguage?: string): SpssOutputLanguage {
  return /^zh(?:[-_]|$)/iu.test(uiLanguage ?? '') ? 'Schinese' : 'English';
}
