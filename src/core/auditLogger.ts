export interface MutationAuditRecord {
  operationId: string;
  project: string;
  tool: string;
  targetPaths: string[];
  beforeHashes: Record<string, string>;
  afterHashes: Record<string, string>;
  snapshotBefore?: string;
  snapshotAfter?: string;
  timestamp: string;
  durationMs: number;
}

export class AuditLogger {
  private static instance: AuditLogger;
  private records: MutationAuditRecord[] = [];
  private readonly maxRecords = 500;

  public static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  public logMutation(record: Omit<MutationAuditRecord, 'timestamp'>): MutationAuditRecord {
    // STRICT CONTRACT: Strip any accidental source code content
    const sanitizedRecord: MutationAuditRecord = {
      operationId: record.operationId,
      project: record.project,
      tool: record.tool,
      targetPaths: [...record.targetPaths],
      beforeHashes: { ...record.beforeHashes },
      afterHashes: { ...record.afterHashes },
      snapshotBefore: record.snapshotBefore,
      snapshotAfter: record.snapshotAfter,
      timestamp: new Date().toISOString(),
      durationMs: record.durationMs,
    };

    this.records.unshift(sanitizedRecord);
    if (this.records.length > this.maxRecords) {
      this.records.pop();
    }

    return sanitizedRecord;
  }

  public getRecords(filter?: { project?: string; tool?: string; operationId?: string }): MutationAuditRecord[] {
    return this.records.filter(r => {
      if (filter?.project && r.project !== filter.project) return false;
      if (filter?.tool && r.tool !== filter.tool) return false;
      if (filter?.operationId && r.operationId !== filter.operationId) return false;
      return true;
    });
  }

  public clear(): void {
    this.records = [];
  }
}
