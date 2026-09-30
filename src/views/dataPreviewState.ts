import type { DatasetPageRequest } from '../spss/types';

const allowedPageSizes = new Set([25, 50, 100, 200, 500]);

export class DataPreviewState {
  private request: DatasetPageRequest;

  public constructor(defaultPageSize = 100) {
    this.request = {
      offset: 0,
      limit: allowedPageSizes.has(defaultPageSize) ? defaultPageSize : 100,
      variableStart: 0,
      variableLimit: 50,
    };
  }

  public get current(): DatasetPageRequest {
    return { ...this.request };
  }

  public update(request: DatasetPageRequest): DatasetPageRequest {
    this.request = {
      offset: Math.max(0, Math.trunc(request.offset)),
      limit: allowedPageSizes.has(request.limit) ? request.limit : 100,
      variableStart: Math.max(0, Math.trunc(request.variableStart)),
      variableLimit: Math.min(200, Math.max(1, Math.trunc(request.variableLimit))),
    };
    return this.current;
  }

  public reset(): void {
    this.request = { ...this.request, offset: 0, variableStart: 0 };
  }
}
