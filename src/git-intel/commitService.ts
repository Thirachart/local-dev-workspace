import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { ProcessService } from '../services/processService.js';
import { SnapshotManager } from '../core/snapshotManager.js';
import { assertGitObservation, getGitObservation } from './gitObservation.js';

export interface SafeCommitOptions {
  message: string;
  files?: string[];
  project?: string;
  expectedSnapshotId?: string;
  expectedGitObservationId?: string;
  expectedFileHashes?: Record<string, string>;
  verificationCommand?: string;
  allowEmpty?: boolean;
}

export interface SafeCommitResult {
  success: boolean;
  commitHash: string;
  shortHash: string;
  branch: string | null;
  filesCommitted: string[];
  snapshotBefore: string;
  snapshotAfter: string;
  gitObservationBefore: string;
  gitObservationAfter: string;
  verificationPassed: boolean;
}

export async function safeGitCommit(
  proc: ProcessService,
  cwd: string,
  options: SafeCommitOptions,
  snapshotManager?: SnapshotManager
): Promise<SafeCommitResult> {
  const gitBefore = await assertGitObservation(proc, cwd, options.expectedGitObservationId, options.project);

  let snapshotBefore = 'unknown';
  if (snapshotManager) {
    const obsBefore = await snapshotManager.getObservationToken(cwd, options.project);
    snapshotBefore = obsBefore.snapshotId;
    if (options.expectedSnapshotId && obsBefore.snapshotId !== options.expectedSnapshotId) {
      const err: any = new Error('[STALE_SNAPSHOT] Workspace state changed before commit.');
      err.category = 'conflict';
      err.code = 'STALE_SNAPSHOT';
      err.details = { expected: options.expectedSnapshotId, actual: obsBefore.snapshotId };
      throw err;
    }
  }

  if (options.expectedFileHashes) {
    for (const [relPath, expectedHash] of Object.entries(options.expectedFileHashes)) {
      const fullPath = path.resolve(cwd, relPath);
      if (!fsSync.existsSync(fullPath)) {
        const err: any = new Error(`[FILE_NOT_FOUND] Cannot commit: File "${relPath}" does not exist.`);
        err.category = 'validation';
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      const actualHash = crypto.createHash('sha256').update(await fs.readFile(fullPath)).digest('hex');
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        const err: any = new Error(`[CONCURRENCY_CONFLICT] Cannot commit: File "${relPath}" changed after observation.`);
        err.category = 'conflict';
        err.code = 'CONCURRENCY_CONFLICT';
        err.details = { path: relPath, expectedHash, actualHash };
        throw err;
      }
    }
  }

  if (options.verificationCommand) {
    const verifyRes = await proc.runCommand({ command: options.verificationCommand, cwd, projectName: options.project });
    if (verifyRes.exitCode !== 0) {
      const err: any = new Error(`[COMMAND_FAILED] Pre-commit verification failed (${options.verificationCommand}).`);
      err.category = 'execution';
      err.code = 'COMMAND_FAILED';
      err.details = { output: verifyRes.stderr || verifyRes.stdout };
      throw err;
    }
  }

  // Re-check HEAD/branch/index after verification and before this function mutates the index.
  const gitBeforeStage = await getGitObservation(proc, cwd, options.project);
  if (gitBeforeStage.observationId !== gitBefore.observationId) {
    const err: any = new Error('[STALE_GIT_OBSERVATION] Git state changed during pre-commit verification.');
    err.category = 'conflict';
    err.code = 'STALE_GIT_OBSERVATION';
    err.details = { before: gitBefore.observationId, current: gitBeforeStage.observationId };
    throw err;
  }

  if (options.files?.length) {
    for (const file of options.files) {
      const safe = file.replace(/"/g, '\\"');
      const addRes = await proc.runCommand({ command: `git add -- "${safe}"`, cwd, projectName: options.project });
      if (addRes.exitCode !== 0) throw new Error(`Failed to stage ${file}: ${addRes.stderr}`);
    }
  } else {
    const addAllRes = await proc.runCommand({ command: 'git add -A', cwd, projectName: options.project });
    if (addAllRes.exitCode !== 0) throw new Error(`Failed to stage changes: ${addAllRes.stderr}`);
  }

  const diffCheck = await proc.runCommand({ command: 'git diff --cached --name-only', cwd, projectName: options.project });
  const filesCommitted = diffCheck.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!filesCommitted.length && !options.allowEmpty) {
    const err: any = new Error('[DIRTY_WORKTREE] Nothing staged to commit.');
    err.category = 'conflict';
    err.code = 'DIRTY_WORKTREE';
    throw err;
  }

  const message = options.message.replace(/"/g, '\\"');
  const commitRes = await proc.runCommand({ command: `git commit -m "${message}" ${options.allowEmpty ? '--allow-empty' : ''}`, cwd, projectName: options.project });
  if (commitRes.exitCode !== 0) {
    const err: any = new Error(`Commit failed: ${commitRes.stderr || commitRes.stdout}`);
    err.category = 'execution';
    err.code = 'COMMAND_FAILED';
    throw err;
  }

  const gitAfter = await getGitObservation(proc, cwd, options.project);
  const snapshotAfter = snapshotManager ? (await snapshotManager.getObservationToken(cwd, options.project)).snapshotId : 'unknown';

  return {
    success: true,
    commitHash: gitAfter.head,
    shortHash: gitAfter.head.slice(0, 7),
    branch: gitAfter.branch,
    filesCommitted,
    snapshotBefore,
    snapshotAfter,
    gitObservationBefore: gitBefore.observationId,
    gitObservationAfter: gitAfter.observationId,
    verificationPassed: true,
  };
}
