export type EngineState = 'stopped' | 'starting' | 'ready' | 'running' | 'error';

export type BridgeOperation =
  | 'ping'
  | 'status'
  | 'run'
  | 'datasetInfo'
  | 'datasetPage'
  | 'variableProfiles'
  | 'shutdown';

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

export interface VariableProfileValueLabel {
  value: DatasetCell;
  label: string;
}

export interface VariableProfileCategory {
  value: DatasetCell;
  frequency: number;
  label?: string;
}

export interface CategoricalVariableSummary {
  kind: 'categorical';
  validN: number;
  missingN: number;
  distinctCount?: number;
  distinctCountAtLeast?: number;
  approximate: boolean;
  topValues: VariableProfileCategory[];
}

export interface ContinuousVariableSummary {
  kind: 'continuous';
  validN: number;
  missingN: number;
  minimum?: number;
  maximum?: number;
  mean?: number;
  standardDeviation?: number;
}

export interface TemporalVariableSummary {
  kind: 'temporal';
  validN: number;
  missingN: number;
  earliest?: string;
  latest?: string;
}

export type VariableProfileSummary =
  | CategoricalVariableSummary
  | ContinuousVariableSummary
  | TemporalVariableSummary;

export interface SpssVariableProfile extends SpssVariableMetadata {
  valueLabels: VariableProfileValueLabel[];
  valueLabelsTruncated: boolean;
  summary: VariableProfileSummary;
}

export interface VariableProfilesRequest {
  variableNames: string[];
}

export interface VariableProfiles {
  datasetName: string;
  caseCount: number;
  weightVariable?: string;
  splitVariables?: string[];
  filterVariable?: string;
  profiles: SpssVariableProfile[];
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
  variableNames?: string[];
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
  variableProfiles?: VariableProfiles;
}

export interface EngineStatus {
  state: EngineState;
  engineAlive: boolean;
  lastError?: string;
  processId?: number;
}
