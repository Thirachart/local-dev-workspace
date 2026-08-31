import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { SnapshotManager } from '../core/snapshotManager.js';

export interface TwoLevelCasOptions {
  fullPath: string;
  expectedSnapshotId?: string;
  expectedSha256?: string;
  snapshotManager?: SnapshotManager;
  project?: string;
  customCwd?: string;
}

export class CasGuard {
  public async computeFileHash(fullPath: string): Promise<string> {
    if (!fsSync.existsSync(fullPath)) return '';
    const buffer = await fs.readFile(fullPath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  public async validateTwoLevelMutation(options: TwoLevelCasOptions): Promise<{ currentFileHash: string; currentSnapshotId?: string }> {
    // Level 1: Coarse Workspace Snapshot Guard
    let currentSnapshotId: string | undefined;
    if (options.expectedSnapshotId && options.snapshotManager) {
      const observation = await options.snapshotManager.getObservationToken(options.customCwd, options.project);
      currentSnapshotId = observation.snapshotId;
      if (observation.snapshotId !== options.expectedSnapshotId) {
        const err: any = new Error(
          `[STALE_SNAPSHOT] Workspace state has shifted. Expected snapshot "${options.expectedSnapshotId}" but current is "${observation.snapshotId}". Please refresh workspace context before mutating.`
        );
        err.category = 'conflict';
        err.code = 'STALE_SNAPSHOT';
        err.details = { expectedSnapshotId: options.expectedSnapshotId, currentSnapshotId: observation.snapshotId };
        throw err;
      }
    }

    // Level 2: Authoritative Per-File CAS Guard
    const exists = fsSync.existsSync(options.fullPath);
    if (!exists) {
      if (options.expectedSha256) {
        const err: any = new Error(`[CONCURRENCY_CONFLICT] Target file does not exist on disk, but expectedSha256 was specified.`);
        err.category = 'conflict';
        err.code = 'CONCURRENCY_CONFLICT';
        throw err;
      }
      return { currentFileHash: '', currentSnapshotId };
    }

    const currentFileHash = await this.computeFileHash(options.fullPath);
    if (options.expectedSha256 && currentFileHash.toLowerCase() !== options.expectedSha256.toLowerCase()) {
      const err: any = new Error(
        `[CONCURRENCY_CONFLICT] Authoritative file hash mismatch for "${options.fullPath}". Expected "${options.expectedSha256}" but disk has "${currentFileHash}".`
      );
      err.category = 'conflict';
      err.code = 'CONCURRENCY_CONFLICT';
      err.details = { expectedSha256: options.expectedSha256, currentFileHash };
      throw err;
    }

    return { currentFileHash, currentSnapshotId };
  }
}
