import type { ActiveDatasetInfo, SpssVariableMetadata } from './types';

export class VariableCache {
  private dataset: ActiveDatasetInfo | undefined;

  public replace(dataset: ActiveDatasetInfo): void {
    this.dataset = dataset.active ? dataset : undefined;
  }

  public clear(): void {
    this.dataset = undefined;
  }

  public get variables(): readonly SpssVariableMetadata[] {
    return this.dataset?.variables ?? [];
  }

  public get info(): ActiveDatasetInfo | undefined {
    return this.dataset;
  }
}
