import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BridgeResponse, ExecutionStatus, RunOutputTarget } from '../spss/types';

export interface ExecutionRecord {
  id: string;
  sequence: number;
  label: string;
  timestamp: string;
  status: ExecutionStatus | 'RUNNING';
  durationMs: number;
  errorLevel: number;
  errorMessage?: string;
  htmlPath?: string;
  outputDirectory: string;
}

export type ExecutionMetadata = Omit<ExecutionRecord, 'outputDirectory' | 'htmlPath'> & { hasHtml: boolean };

export class OutputStore {
  public readonly sessionRoot: string;
  private readonly records = new Map<string, ExecutionRecord>();
  private nextSequence = 1;
  private selectedId: string | undefined;

  public constructor(temporaryRoot = os.tmpdir()) {
    const base = path.join(temporaryRoot, 'spss-studio');
    fs.mkdirSync(base, { recursive: true });
    this.sessionRoot = fs.mkdtempSync(path.join(base, 'session-'));
  }

  public begin(label: string): { record: ExecutionRecord; target: RunOutputTarget } {
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    const id = `run-${String(sequence)}-${randomUUID()}`;
    const outputDirectory = path.join(this.sessionRoot, id);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const record: ExecutionRecord = {
      id,
      sequence,
      label,
      timestamp: new Date().toISOString(),
      status: 'RUNNING',
      durationMs: 0,
      errorLevel: 0,
      outputDirectory,
    };
    this.records.set(id, record);
    this.selectedId = id;
    return { record, target: { runId: id, outputDirectory } };
  }

  public complete(id: string, response: BridgeResponse): ExecutionRecord {
    const record = this.requireRecord(id);
    const completed: ExecutionRecord = {
      ...record,
      status: response.status ?? (response.ok ? 'SUCCESS_NO_OUTPUT' : 'ERROR'),
      durationMs: response.durationMs,
      errorLevel: response.errorLevel,
      ...(response.error ? { errorMessage: response.error } : {}),
      ...(response.htmlPath ? { htmlPath: response.htmlPath } : {}),
    };
    this.records.set(id, completed);
    this.selectedId = id;
    return completed;
  }

  public fail(id: string, error: unknown, status: ExecutionStatus = 'ENGINE_ERROR'): ExecutionRecord {
    const record = this.requireRecord(id);
    const message = error instanceof Error ? error.message : String(error);
    const failed: ExecutionRecord = {
      ...record,
      status,
      errorLevel: status === 'TIMEOUT' ? 0 : 5,
      errorMessage: message,
    };
    this.records.set(id, failed);
    this.selectedId = id;
    return failed;
  }

  public get metadata(): ExecutionMetadata[] {
    return [...this.records.values()]
      .sort((left, right) => right.sequence - left.sequence)
      .map((record) => ({
        id: record.id,
        sequence: record.sequence,
        label: record.label,
        timestamp: record.timestamp,
        status: record.status,
        durationMs: record.durationMs,
        errorLevel: record.errorLevel,
        ...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
        hasHtml: record.htmlPath !== undefined,
      }));
  }

  public get selected(): ExecutionRecord | undefined {
    return this.selectedId ? this.records.get(this.selectedId) : undefined;
  }

  public select(id: string): ExecutionRecord {
    const record = this.requireRecord(id);
    this.selectedId = id;
    return record;
  }

  public get(id: string): ExecutionRecord | undefined {
    return this.records.get(id);
  }

  public readHtml(id: string): string | undefined {
    const record = this.requireRecord(id);
    if (!record.htmlPath || !fs.existsSync(record.htmlPath)) {
      return undefined;
    }
    return fs.readFileSync(record.htmlPath, 'utf8');
  }

  public clear(): void {
    for (const record of this.records.values()) {
      fs.rmSync(record.outputDirectory, { recursive: true, force: true });
    }
    this.records.clear();
    this.selectedId = undefined;
  }

  public dispose(): void {
    fs.rmSync(this.sessionRoot, { recursive: true, force: true });
    this.records.clear();
    this.selectedId = undefined;
  }

  private requireRecord(id: string): ExecutionRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new Error(`Unknown SPSS execution record: ${id}`);
    }
    return record;
  }
}
