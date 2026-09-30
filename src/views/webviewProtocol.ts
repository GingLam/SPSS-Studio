import type { ActiveDatasetInfo, DatasetPage, DatasetPageRequest, EngineState } from '../spss/types';
import type { ExecutionMetadata } from './outputStore';

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
  | { type: 'outputCleared' };

export type WebviewToExtensionMessage =
  | { type: 'selectExecution'; id: string }
  | { type: 'showOutput' }
  | { type: 'showData' }
  | { type: 'showVariables' }
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
  | { type: 'exportOutput'; id: string }
  | { type: 'printOutput'; id: string }
  | { type: 'clearOutput' };

export function isWebviewMessage(value: unknown): value is WebviewToExtensionMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  const type = message.type;
  if (['showOutput', 'showData', 'showVariables', 'refreshData', 'refreshVariables', 'clearOutput'].includes(String(type))) {
    return true;
  }
  if (['selectExecution', 'exportOutput', 'printOutput'].includes(String(type))) {
    return typeof message.id === 'string' && message.id.length > 0;
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
