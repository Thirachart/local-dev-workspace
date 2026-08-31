import crypto from 'node:crypto';
import { DiagnosticItem } from './diagParser.js';

export interface DiagnosticBaseline {
  baselineId: string;
  task: string;
  warningHashes: Set<string>;
  warningCount: number;
  createdAt: string;
}

export class DiagnosticBaselineManager {
  private baselines = new Map<string, DiagnosticBaseline>();

  public createBaseline(task: string, warnings: DiagnosticItem[]): DiagnosticBaseline {
    const warningHashes = new Set<string>();
    for (const w of warnings) {
      const key = `${w.tool}:${w.code || ''}:${w.path || ''}:${w.line || 0}:${w.message}`;
      warningHashes.add(crypto.createHash('sha256').update(key).digest('hex').slice(0, 16));
    }

    const baselineId = `diagbase_${crypto.randomBytes(4).toString('hex')}`;
    const baseline: DiagnosticBaseline = {
      baselineId,
      task,
      warningHashes,
      warningCount: warnings.length,
      createdAt: new Date().toISOString(),
    };

    this.baselines.set(baselineId, baseline);
    return baseline;
  }

  public filterAgainstBaseline(
    baselineId: string,
    warnings: DiagnosticItem[]
  ): { newWarnings: DiagnosticItem[]; suppressedCount: number } {
    const baseline = this.baselines.get(baselineId);
    if (!baseline) {
      return { newWarnings: warnings, suppressedCount: 0 };
    }

    const newWarnings: DiagnosticItem[] = [];
    let suppressedCount = 0;

    for (const w of warnings) {
      const key = `${w.tool}:${w.code || ''}:${w.path || ''}:${w.line || 0}:${w.message}`;
      const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
      if (baseline.warningHashes.has(hash)) {
        suppressedCount++;
      } else {
        newWarnings.push(w);
      }
    }

    return { newWarnings, suppressedCount };
  }
}
