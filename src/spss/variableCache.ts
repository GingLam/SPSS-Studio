import type { ActiveDatasetInfo, SpssVariableMetadata } from './types';

export class VariableCache {
  private dataset: ActiveDatasetInfo | undefined;
  private signature: string | undefined;
  private readonly listeners = new Set<() => void>();

  public replace(dataset: ActiveDatasetInfo): void {
    const next = dataset.active ? dataset : undefined;
    const signature = next ? JSON.stringify(next) : undefined;
    if (signature === this.signature) {
      return;
    }
    this.dataset = next;
    this.signature = signature;
    this.notify();
  }

  public clear(): void {
    if (!this.dataset) {
      return;
    }
    this.dataset = undefined;
    this.signature = undefined;
    this.notify();
  }

  public onDidChange(listener: () => void): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  public dispose(): void {
    this.listeners.clear();
  }

  public get variables(): readonly SpssVariableMetadata[] {
    return this.dataset?.variables ?? [];
  }

  public get info(): ActiveDatasetInfo | undefined {
    return this.dataset;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
