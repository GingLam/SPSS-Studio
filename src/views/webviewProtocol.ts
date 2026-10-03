import type { ActiveDatasetInfo, DatasetPage, DatasetPageRequest, EngineState } from '../spss/types';
import type { ExecutionMetadata } from './outputStore';

const MAX_VARIABLE_NAMES_PER_MESSAGE = 100_000;

export interface DatasetPageUiRequest extends DatasetPageRequest {
  requestId: number;
  generation: number;
}

export type ExtensionToWebviewMessage =
  | { type: 'executionStarted'; history: ExecutionMetadata[]; selectedId: string }
  | { type: 'executionCompleted'; history: ExecutionMetadata[]; selectedId: string }
  | { type: 'executionSelected'; record: ExecutionMetadata; html: string }
  | { type: 'datasetMetadata'; dataset: ActiveDatasetInfo | null; revision: number }
  | { type: 'datasetPage'; page: DatasetPage; requestId: number; generation: number }
  | { type: 'engineState'; state: EngineState }
  | { type: 'showOutput' }
  | { type: 'showData' }
  | { type: 'showVariables' }
  | { type: 'showAi' }
  | { type: 'outputCleared' }
  | { type: 'variableExploreFinished' };

export type WebviewToExtensionMessage =
  | { type: 'selectExecution'; id: string }
  | { type: 'showOutput' }
  | { type: 'showData' }
  | { type: 'showVariables' }
  | { type: 'showAi' }
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
  | { type: 'explainOutput'; id: string }
  | { type: 'exportOutput'; id: string }
  | { type: 'printOutput'; id: string }
  | { type: 'insertVariable'; name: string }
  | { type: 'copyVariables'; names: string[] }
  | { type: 'insertVariables'; names: string[] }
  | { type: 'exploreVariables'; names: string[] }
  | { type: 'clearOutput' };

export function isWebviewMessage(value: unknown): value is WebviewToExtensionMessage {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    return false;
  }
  const message = value;
  const type = String(message.type);
  if (['showOutput', 'showData', 'showVariables', 'showAi', 'refreshData', 'refreshVariables', 'clearOutput'].includes(type)) {
    return true;
  }
  if (['selectExecution', 'explainOutput', 'exportOutput', 'printOutput'].includes(type)) {
    return typeof message.id === 'string' && message.id.length > 0;
  }
  if (type === 'insertVariable') {
    return typeof message.name === 'string' && message.name.length > 0 && message.name.length <= 64;
  }
  if (type === 'copyVariables' || type === 'insertVariables' || type === 'exploreVariables') {
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
