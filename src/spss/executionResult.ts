import type { BridgeResponse } from './types';

type DatasetRefreshResult = Pick<BridgeResponse, 'status' | 'engineAlive'>;

/**
 * SPSS does not roll back commands that ran before a later syntax error.
 * Refresh metadata while the processor remains alive so editor state is honest.
 */
export function shouldRefreshDatasetMetadata(response: DatasetRefreshResult): boolean {
  if (response.engineAlive === false) {
    return false;
  }
  return response.status === 'SUCCESS'
    || response.status === 'SUCCESS_NO_OUTPUT'
    || response.status === 'WARNING'
    || response.status === 'ERROR';
}
