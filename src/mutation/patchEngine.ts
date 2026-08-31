import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { AtomicWriter } from './atomicWriter.js';
import { CasGuard } from './casGuard.js';
import { SnapshotManager } from '../core/snapshotManager.js';
import { AuditLogger } from '../core/auditLogger.js';

export interface ReplaceExactOp {
  type: 'replaceExact';
  target: string;
  replacement: string;
  expectedOccurrences?: number;
}

export interface ReplaceRangeOp {
  type: 'replaceRange';
  startLine: number;
  endLine: number;
  replacement: string;
  expectedRangeSha256?: string;
}

export type PatchOperation = ReplaceExactOp | ReplaceRangeOp;

export interface FilePatchRequest {
  path: string;
  expectedSha256: string;
  operations: PatchOperation[];
}

export interface ApplyPatchRequest {
  expectedSnapshotId?: string;
  files: FilePatchRequest[];
  project?: string;
  cwd?: string;
}

export interface ApplyPatchResult {
  atomicity: 'per-file';
  completedFiles: Array<{
    path: string;
    beforeSha256: string;
    afterSha256: string;
    linesChanged: string;
    outsidePatchUnchanged: boolean;
  }>;
  failedFile?: string;
  error?: string;
}

export class PatchEngine {
  private writer = new AtomicWriter();
  private casGuard = new CasGuard();
  private auditLogger = AuditLogger.getInstance();

  constructor(
    private baseDir: string,
    private snapshotManager?: SnapshotManager
  ) {}

  public async applyPatch(req: ApplyPatchRequest, options?: { operationId?: string }): Promise<ApplyPatchResult> {
    const completedFiles: ApplyPatchResult['completedFiles'] = [];
    const operationId = options?.operationId || `op_patch_${Date.now()}`;
    const startTime = Date.now();

    // 1. Validate Coarse Snapshot if provided
    let snapshotBefore: string | undefined;
    if (req.expectedSnapshotId && this.snapshotManager) {
      const observation = await this.snapshotManager.getObservationToken(req.cwd, req.project);
      snapshotBefore = observation.snapshotId;
      if (observation.snapshotId !== req.expectedSnapshotId) {
        const err: any = new Error(
          `[STALE_SNAPSHOT] Workspace observation token mismatch. Expected "${req.expectedSnapshotId}" but found "${observation.snapshotId}".`
        );
        err.category = 'conflict';
        err.code = 'STALE_SNAPSHOT';
        throw err;
      }
    }

    const beforeHashes: Record<string, string> = {};
    const afterHashes: Record<string, string> = {};

    // 2. Process Files Sequentially (Strict Per-File Atomicity Contract)
    for (const fileReq of req.files) {
      const fullPath = path.isAbsolute(fileReq.path) ? fileReq.path : path.resolve(this.baseDir, req.cwd || '.', fileReq.path);

      try {
        if (!fsSync.existsSync(fullPath)) {
          throw new Error(`[FILE_NOT_FOUND] Target file "${fileReq.path}" does not exist.`);
        }

        const originalContent = await fs.readFile(fullPath, 'utf-8');
        const currentHash = crypto.createHash('sha256').update(originalContent, 'utf-8').digest('hex');
        beforeHashes[fileReq.path] = currentHash;

        if (fileReq.expectedSha256 && currentHash.toLowerCase() !== fileReq.expectedSha256.toLowerCase()) {
          throw new Error(
            `[CONCURRENCY_CONFLICT] File "${fileReq.path}" hash mismatch. Expected "${fileReq.expectedSha256}" but found "${currentHash}".`
          );
        }

        let workingContent = originalContent;
        let linesChangedSummary = '';

        for (const op of fileReq.operations) {
          if (op.type === 'replaceExact') {
            const occurrences = workingContent.split(op.target).length - 1;
            const expected = op.expectedOccurrences ?? 1;
            if (occurrences === 0) {
              throw new Error(`[PATCH_CONFLICT] Target substring not found in "${fileReq.path}".`);
            }
            if (occurrences !== expected) {
              throw new Error(
                `[PATCH_CONFLICT] Target substring found ${occurrences} times, expected ${expected} in "${fileReq.path}".`
              );
            }
            workingContent = workingContent.replace(op.target, op.replacement);
            linesChangedSummary = `exact-replace (${occurrences} matches)`;
          } else if (op.type === 'replaceRange') {
            const isCrlf = workingContent.includes('\r\n');
            const lines = workingContent.split(/\r?\n/);

            if (op.startLine < 1 || op.endLine > lines.length || op.startLine > op.endLine) {
              throw new Error(
                `[PATCH_CONFLICT] Invalid line range ${op.startLine}-${op.endLine} for file with ${lines.length} lines.`
              );
            }

            const beforeLines = lines.slice(0, op.startLine - 1);
            const afterLines = lines.slice(op.endLine);
            const replacementLines = op.replacement.split(/\r?\n/);
            const newLines = [...beforeLines, ...replacementLines, ...afterLines];

            const joiner = isCrlf ? '\r\n' : '\n';
            workingContent = newLines.join(joiner);
            linesChangedSummary = `${op.startLine}-${op.endLine}`;
          }
        }

        // Apply via AtomicWriter
        const writeResult = await this.writer.writeAtomic(fullPath, workingContent, {
          expectedSha256: currentHash,
          preserveNewline: true,
        });

        afterHashes[fileReq.path] = writeResult.afterSha256;

        completedFiles.push({
          path: fileReq.path,
          beforeSha256: currentHash,
          afterSha256: writeResult.afterSha256,
          linesChanged: linesChangedSummary,
          outsidePatchUnchanged: true,
        });
      } catch (err: any) {
        // Log mutation audit up to failure point
        this.auditLogger.logMutation({
          operationId,
          project: req.project || 'default',
          tool: 'apply_patch',
          targetPaths: req.files.map(f => f.path),
          beforeHashes,
          afterHashes,
          snapshotBefore,
          durationMs: Date.now() - startTime,
        });

        return {
          atomicity: 'per-file',
          completedFiles,
          failedFile: fileReq.path,
          error: err.message,
        };
      }
    }

    // Log full audit record on complete success
    this.auditLogger.logMutation({
      operationId,
      project: req.project || 'default',
      tool: 'apply_patch',
      targetPaths: req.files.map(f => f.path),
      beforeHashes,
      afterHashes,
      snapshotBefore,
      durationMs: Date.now() - startTime,
    });

    return {
      atomicity: 'per-file',
      completedFiles,
    };
  }
}
