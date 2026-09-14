import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlatformAdapter } from '../platform/platformFactory.js';
import type { PlatformAdapter } from '../platform/platformAdapter.js';

export type FileMutationKind = 'write' | 'edit' | 'delete' | 'move' | 'patch' | 'changeset' | 'copy' | 'sync' | 'config';

export interface MutationFileState {
  relativePath: string;
  existed: boolean;
  isFile: boolean;
  sha256?: string;
  sizeBytes?: number;
  backupFile?: string;
}

export interface MutationRecord {
  operationId: string;
  kind: FileMutationKind;
  projectKey: string;
  createdAt: string;
  completedAt: string;
  undoneAt?: string;
  status: 'completed' | 'undone';
  undoable: boolean;
  before: MutationFileState[];
  after: MutationFileState[];
  metadata?: Record<string, unknown>;
}

export interface PendingMutation {
  operationId: string;
  kind: FileMutationKind;
  projectRoot: string;
  projectKey: string;
  operationDir: string;
  before: MutationFileState[];
  fullPaths: string[];
  undoable: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export class MutationJournal {
  private readonly stateRoot: string;

  constructor(
    stateRoot?: string,
    private readonly platformAdapter: PlatformAdapter = createPlatformAdapter(),
  ) {
    this.stateRoot = path.resolve(
      stateRoot || process.env.CHAT_DEV_MCP_STATE_DIR || path.join(os.homedir(), '.chat-dev-mcp'),
    );
  }

  private normalizeRoot(projectRoot: string): string {
    const resolved = path.resolve(projectRoot);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  private projectKey(projectRoot: string): string {
    return crypto.createHash('sha256').update(this.normalizeRoot(projectRoot)).digest('hex').slice(0, 24);
  }

  private mutationsRoot(projectRoot: string): string {
    return path.join(this.stateRoot, 'mutations', this.projectKey(projectRoot));
  }

  private assertInsideProject(projectRoot: string, fullPath: string): void {
    const root = path.resolve(projectRoot);
    const resolved = path.resolve(fullPath);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      const err: any = new Error(`[MUTATION_PATH_OUTSIDE_PROJECT] Refusing to journal path outside project root: ${fullPath}`);
      err.code = 'MUTATION_PATH_OUTSIDE_PROJECT';
      err.category = 'permission';
      throw err;
    }
  }

  private async hashFile(fullPath: string): Promise<{ sha256: string; sizeBytes: number }> {
    const buffer = await fs.readFile(fullPath);
    return {
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      sizeBytes: buffer.byteLength,
    };
  }

  private async snapshot(
    projectRoot: string,
    fullPath: string,
    operationDir: string,
    index: number,
    keepBackup: boolean,
  ): Promise<MutationFileState> {
    this.assertInsideProject(projectRoot, fullPath);
    const relativePath = path.relative(projectRoot, fullPath).split(path.sep).join('/');
    if (!fsSync.existsSync(fullPath)) {
      return { relativePath, existed: false, isFile: false };
    }

    const stat = await fs.lstat(fullPath);
    if (!stat.isFile()) {
      return { relativePath, existed: true, isFile: false, sizeBytes: stat.size };
    }

    const { sha256, sizeBytes } = await this.hashFile(fullPath);
    let backupFile: string | undefined;
    if (keepBackup) {
      const backupDir = path.join(operationDir, 'backups');
      await fs.mkdir(backupDir, { recursive: true });
      backupFile = path.join('backups', `${index}.bin`).split(path.sep).join('/');
      await fs.copyFile(fullPath, path.join(operationDir, backupFile));
    }
    return { relativePath, existed: true, isFile: true, sha256, sizeBytes, backupFile };
  }

  public async begin(
    projectRoot: string,
    kind: FileMutationKind,
    fullPaths: string[],
    metadata?: Record<string, unknown>,
  ): Promise<PendingMutation> {
    const root = path.resolve(projectRoot);
    const uniquePaths = Array.from(new Set(fullPaths.map((item) => path.resolve(item))));
    for (const fullPath of uniquePaths) this.assertInsideProject(root, fullPath);

    const operationId = `mut_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const operationDir = path.join(this.mutationsRoot(root), operationId);
    await fs.mkdir(operationDir, { recursive: true });

    try {
      const before: MutationFileState[] = [];
      for (let index = 0; index < uniquePaths.length; index++) {
        before.push(await this.snapshot(root, uniquePaths[index], operationDir, index, true));
      }
      return {
        operationId,
        kind,
        projectRoot: root,
        projectKey: this.projectKey(root),
        operationDir,
        before,
        fullPaths: uniquePaths,
        undoable: before.every((item) => !item.existed || item.isFile),
        metadata,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      await fs.rm(operationDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  public async complete(pending: PendingMutation): Promise<MutationRecord> {
    const after: MutationFileState[] = [];
    for (let index = 0; index < pending.fullPaths.length; index++) {
      after.push(await this.snapshot(pending.projectRoot, pending.fullPaths[index], pending.operationDir, index, false));
    }
    const undoable = pending.undoable && after.every((item) => !item.existed || item.isFile);
    const record: MutationRecord = {
      operationId: pending.operationId,
      kind: pending.kind,
      projectKey: pending.projectKey,
      createdAt: pending.createdAt,
      completedAt: new Date().toISOString(),
      status: 'completed',
      undoable,
      before: pending.before,
      after,
      metadata: pending.metadata,
    };
    await fs.writeFile(path.join(pending.operationDir, 'record.json'), JSON.stringify(record, null, 2), 'utf8');
    return record;
  }

  public async abort(pending: PendingMutation): Promise<void> {
    await fs.rm(pending.operationDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private async restoreState(projectRoot: string, operationDir: string, state: MutationFileState): Promise<void> {
    const fullPath = path.join(projectRoot, state.relativePath);
    this.assertInsideProject(projectRoot, fullPath);

    if (!state.existed) {
      await fs.rm(fullPath, { force: true }).catch(() => undefined);
      return;
    }
    if (!state.isFile || !state.backupFile) {
      const err: any = new Error(`[UNDO_UNSUPPORTED_TARGET] Mutation contains a non-file target: ${state.relativePath}`);
      err.code = 'UNDO_UNSUPPORTED_TARGET';
      err.category = 'validation';
      throw err;
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const nonce = crypto.randomBytes(6).toString('hex');
    const tempFile = path.join(path.dirname(fullPath), `.undo.${path.basename(fullPath)}.${nonce}`);
    await fs.copyFile(path.join(operationDir, state.backupFile), tempFile);
    try {
      await this.platformAdapter.atomicReplace({ sourcePath: tempFile, targetPath: fullPath });
    } finally {
      await fs.rm(tempFile, { force: true }).catch(() => undefined);
    }
  }

  private async assertMatchesAfter(projectRoot: string, state: MutationFileState): Promise<void> {
    const fullPath = path.join(projectRoot, state.relativePath);
    const exists = fsSync.existsSync(fullPath);
    if (!state.existed) {
      if (exists) {
        const err: any = new Error(`[UNDO_CONCURRENCY_CONFLICT] ${state.relativePath} was created after the recorded mutation.`);
        err.code = 'UNDO_CONCURRENCY_CONFLICT';
        err.category = 'conflict';
        throw err;
      }
      return;
    }
    if (!exists) {
      const err: any = new Error(`[UNDO_CONCURRENCY_CONFLICT] ${state.relativePath} no longer exists.`);
      err.code = 'UNDO_CONCURRENCY_CONFLICT';
      err.category = 'conflict';
      throw err;
    }
    const stat = await fs.lstat(fullPath);
    if (!state.isFile || !stat.isFile()) {
      const err: any = new Error(`[UNDO_UNSUPPORTED_TARGET] Undo supports regular files only: ${state.relativePath}`);
      err.code = 'UNDO_UNSUPPORTED_TARGET';
      err.category = 'validation';
      throw err;
    }
    const current = await this.hashFile(fullPath);
    if (current.sha256 !== state.sha256) {
      const err: any = new Error(`[UNDO_CONCURRENCY_CONFLICT] ${state.relativePath} changed after the recorded mutation.`);
      err.code = 'UNDO_CONCURRENCY_CONFLICT';
      err.category = 'conflict';
      err.details = { expectedAfterHash: state.sha256, currentHash: current.sha256 };
      throw err;
    }
  }

  private async readRecord(projectRoot: string, operationId: string): Promise<{ record: MutationRecord; operationDir: string }> {
    if (!/^mut_[A-Za-z0-9_-]+$/.test(operationId)) {
      const err: any = new Error('[INVALID_OPERATION_ID] Invalid mutation operation ID.');
      err.code = 'INVALID_OPERATION_ID';
      err.category = 'validation';
      throw err;
    }
    const operationDir = path.join(this.mutationsRoot(projectRoot), operationId);
    const recordPath = path.join(operationDir, 'record.json');
    if (!fsSync.existsSync(recordPath)) {
      const err: any = new Error(`[MUTATION_NOT_FOUND] Mutation operation not found: ${operationId}`);
      err.code = 'MUTATION_NOT_FOUND';
      err.category = 'not_found';
      throw err;
    }
    const record = JSON.parse(await fs.readFile(recordPath, 'utf8')) as MutationRecord;
    if (record.projectKey !== this.projectKey(projectRoot)) {
      const err: any = new Error('[MUTATION_PROJECT_MISMATCH] Mutation belongs to a different project.');
      err.code = 'MUTATION_PROJECT_MISMATCH';
      err.category = 'permission';
      throw err;
    }
    return { record, operationDir };
  }

  public async undo(projectRoot: string, operationId: string): Promise<MutationRecord> {
    const root = path.resolve(projectRoot);
    const { record, operationDir } = await this.readRecord(root, operationId);
    if (!record.undoable) {
      const err: any = new Error('[UNDO_NOT_AVAILABLE] Mutation contains targets that are not regular files.');
      err.code = 'UNDO_NOT_AVAILABLE';
      err.category = 'validation';
      throw err;
    }
    if (record.status === 'undone') {
      const err: any = new Error('[MUTATION_ALREADY_UNDONE] Mutation has already been undone.');
      err.code = 'MUTATION_ALREADY_UNDONE';
      err.category = 'conflict';
      throw err;
    }

    for (const state of record.after) await this.assertMatchesAfter(root, state);
    for (const state of record.before) await this.restoreState(root, operationDir, state);

    const updated: MutationRecord = {
      ...record,
      status: 'undone',
      undoneAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(operationDir, 'record.json'), JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  }

  public async rollbackPending(pending: PendingMutation): Promise<void> {
    if (!pending.undoable) {
      const err: any = new Error('[ROLLBACK_NOT_AVAILABLE] Pending mutation contains a non-file target.');
      err.code = 'ROLLBACK_NOT_AVAILABLE';
      err.category = 'validation';
      throw err;
    }
    for (const state of pending.before) await this.restoreState(pending.projectRoot, pending.operationDir, state);
    await this.abort(pending);
  }

  public async get(projectRoot: string, operationId: string): Promise<MutationRecord> {
    return (await this.readRecord(path.resolve(projectRoot), operationId)).record;
  }
}
