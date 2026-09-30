export type EngineState = 'stopped' | 'starting' | 'ready' | 'running' | 'error';

export type BridgeOperation = 'ping' | 'status' | 'run' | 'datasetInfo' | 'datasetPage' | 'shutdown';

export type ExecutionStatus =
  | 'SUCCESS'
  | 'SUCCESS_NO_OUTPUT'
  | 'WARNING'
  | 'ERROR'
  | 'ENGINE_ERROR'
  | 'TIMEOUT';

export interface SpssVariableMetadata {
  index: number;
  name: string;
  label: string;
  type: string;
  format: string;
  measurementLevel?: string;
}

export interface ActiveDatasetInfo {
  active: boolean;
  datasetName: string;
  caseCount: number;
  variableCount: number;
  variables: SpssVariableMetadata[];
  weightVariable?: string;
  splitVariables?: string[];
  filterVariable?: string;
}

export type DatasetCell = string | number | boolean | null;

export interface DatasetPage {
  datasetName: string;
  totalCases: number;
  totalVariables: number;
  offset: number;
  limit: number;
  variableStart: number;
  variableLimit: number;
  variables: SpssVariableMetadata[];
  rows: DatasetCell[][];
}

export interface DatasetPageRequest {
  offset: number;
  limit: number;
  variableStart: number;
  variableLimit: number;
}

export interface RunOutputTarget {
  runId: string;
  outputDirectory: string;
}

export interface BridgeRequest {
  id: string;
  op: BridgeOperation;
  syntax?: string;
  runId?: string;
  outputDirectory?: string;
  offset?: number;
  limit?: number;
  variableStart?: number;
  variableLimit?: number;
}

export interface BridgeResponse {
  id: string;
  ok: boolean;
  errorLevel: number;
  output: string;
  warnings: string[];
  error: string | null;
  durationMs: number;
  engineAlive?: boolean;
  status?: ExecutionStatus;
  htmlPath?: string | null;
  datasetInfo?: ActiveDatasetInfo;
  datasetPage?: DatasetPage;
}

export interface EngineStatus {
  state: EngineState;
  engineAlive: boolean;
  lastError?: string;
  processId?: number;
}
