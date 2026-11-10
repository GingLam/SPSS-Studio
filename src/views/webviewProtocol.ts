import type { ActiveDatasetInfo, DatasetPage, DatasetPageRequest, EngineState } from '../spss/types';
import type { ExecutionMetadata } from './outputStore';

export const STUDIO_THEMES = ['SPSS Studio Light', 'SPSS Studio Dark'] as const;
export type StudioTheme = typeof STUDIO_THEMES[number] | 'other';

export function isStudioFontSize(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 28);
}

const MAX_VARIABLE_NAMES_PER_MESSAGE = 100_000;

export interface DatasetPageUiRequest extends DatasetPageRequest {
  requestId: number;
  generation: number;
}

export type ExtensionToWebviewMessage =
  | { type: 'executionStarted'; history: ExecutionMetadata[]; selectedId: string }
  | { type: 'executionCompleted'; history: ExecutionMetadata[]; selectedId: string }
  | { type: 'executionSelected'; record: ExecutionMetadata; html: string; diagnostic?: boolean; blocks?: Array<{ id: string; title: string }> }
  | { type: 'datasetMetadata'; dataset: ActiveDatasetInfo | null; revision: number }
  | { type: 'datasetPage'; page: DatasetPage; requestId: number; generation: number }
  | { type: 'engineState'; state: EngineState }
  | { type: 'showOutput' }
  | { type: 'showData' }
  | { type: 'showVariables' }
  | { type: 'showAi' }
  | { type: 'showSettings' }
  | { type: 'outputCleared' }
  | { type: 'dataCleared' }
  | { type: 'dataActionState'; busy: boolean }
  | { type: 'variableExploreFinished' }
  | { type: 'systemSettings'; theme: string; fontSize: number | null; editorFontSize: number | null };

export type WebviewToExtensionMessage =
  | { type: 'selectExecution'; id: string }
  | { type: 'showOutput' }
  | { type: 'showData' }
  | { type: 'showVariables' }
  | { type: 'showAi' }
  | { type: 'showSettings' }
  | {
    type: 'requestDatasetPage';
    offset: number;
    limit: number;
    variableStart: number;
    variableLimit: number;
    requestId: number;
    generation: number;
  }
  | { type: 'refreshData' }
  | { type: 'refreshVariables' }
  | { type: 'explainOutput'; id: string; blockIds?: string[] }
  | { type: 'exportOutput'; id: string; blockIds?: string[] }
  | { type: 'printOutput'; id: string; blockIds?: string[] }
  | { type: 'insertVariable'; name: string }
  | { type: 'copyVariables'; names: string[] }
  | { type: 'insertVariables'; names: string[] }
  | { type: 'exploreVariables'; names: string[]; revision: number; checked: boolean }
  | { type: 'outputSelectionChanged'; id: string; blockIds: string[] }
  | { type: 'variableSelectionChanged'; revision: number; names: string[] }
  | { type: 'clearOutput' }
  | { type: 'clearData' }
  | { type: 'openQuickStart' }
  | { type: 'setStudioTheme'; theme: StudioTheme }
  | { type: 'setStudioFontSize' | 'setSpssEditorFontSize'; fontSize: number | null };

export function isWebviewMessage(value: unknown): value is WebviewToExtensionMessage {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    return false;
  }
  const message = value;
  const type = String(message.type);
  if (['showOutput', 'showData', 'showVariables', 'showAi', 'showSettings', 'refreshData', 'refreshVariables', 'clearOutput', 'clearData', 'openQuickStart'].includes(type)) {
    return true;
  }
  if (type === 'setStudioTheme') {
    return message.theme === 'other' || STUDIO_THEMES.some((theme) => theme === message.theme);
  }
  if (type === 'setStudioFontSize' || type === 'setSpssEditorFontSize') {
    return isStudioFontSize(message.fontSize);
  }
  if (['explainOutput', 'exportOutput', 'printOutput', 'outputSelectionChanged'].includes(type)) {
    return typeof message.id === 'string' && message.id.length > 0
      && ((type !== 'outputSelectionChanged' && message.blockIds === undefined)
        || (Array.isArray(message.blockIds) && message.blockIds.length <= 1000
        && message.blockIds.every((id) => typeof id === 'string' && /^block-[1-9]\d{0,5}$/u.test(id))
        && new Set(message.blockIds).size === message.blockIds.length));
  }
  if (type === 'selectExecution') {
    return typeof message.id === 'string' && message.id.length > 0;
  }
  if (type === 'insertVariable') {
    return typeof message.name === 'string' && message.name.length > 0 && message.name.length <= 64;
  }
  if (type === 'variableSelectionChanged' || type === 'exploreVariables') {
    return Number.isSafeInteger(message.revision) && Number(message.revision) >= 0
      && (type === 'variableSelectionChanged'
        ? Array.isArray(message.names) && (message.names.length === 0 || validVariableNames(message.names))
        : typeof message.checked === 'boolean' && validVariableNames(message.names));
  }
  if (type === 'copyVariables' || type === 'insertVariables') {
    return validVariableNames(message.names);
  }
  if (type !== 'requestDatasetPage') {
    return false;
  }
  const integers = ['offset', 'limit', 'variableStart', 'variableLimit', 'requestId', 'generation'] as const;
  if (!integers.every((key) => Number.isInteger(message[key]) && Number(message[key]) >= 0)) {
    return false;
  }
  return Number(message.limit) > 0 && Number(message.variableLimit) > 0 && Number(message.variableLimit) <= 200;
}

function validVariableNames(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= MAX_VARIABLE_NAMES_PER_MESSAGE
    && value.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 64);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
