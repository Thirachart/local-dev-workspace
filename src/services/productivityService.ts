import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { MutationJournal, type FileMutationKind, type MutationRecord } from '../mutation/mutationJournal.js';
import { createPlatformAdapter } from '../platform/platformFactory.js';
import type { PlatformAdapter } from '../platform/platformAdapter.js';
import { FileService, type WriteFileMode } from './fileService.js';
import { PatchService, type PatchChunk } from './patchService.js';
import { ProjectService } from './projectService.js';

export type ConfigPatchOperation = {
  op: 'set' | 'remove';
  path: string;
  value?: unknown;
};

export type FileChangesetOperation =
  | { type: 'write'; path: string; content: string; mode?: WriteFileMode; expectedBeforeHash?: string }
  | { type: 'edit'; path: string; targetContent: string; replacementContent: string; allowMultiple?: boolean; expectedBeforeHash?: string }
  | { type: 'delete'; path: string; force?: boolean }
  | { type: 'move'; sourcePath: string; destPath: string; overwrite?: boolean }
  | { type: 'patch'; chunks: PatchChunk[] };

export class ProductivityService {
  constructor(
    private readonly fileService: FileService,
    private readonly patchService: PatchService,
    private readonly projectService: ProjectService,
    private readonly journal: MutationJournal = new MutationJournal(),
    private readonly platformAdapter: PlatformAdapter = createPlatformAdapter(),
  ) {}

  private projectRoot(project: string, cwd?: string): string {
    return this.fileService.resolvePath('.', cwd, project).projectRoot;
  }

  private resolve(project: string, cwd: string | undefined, targetPath: string): string {
    return this.fileService.resolvePath(targetPath, cwd, project).fullPath;
  }

  public async journalMutation<T>(
    kind: FileMutationKind,
    paths: string[],
    options: { project: string; cwd?: string; metadata?: Record<string, unknown> },
    action: () => Promise<T>,
  ): Promise<{ result: T; mutation: MutationRecord }> {
    const root = this.projectRoot(options.project, options.cwd);
    const fullPaths = paths.map((targetPath) => this.resolve(options.project, options.cwd, targetPath));
    const pending = await this.journal.begin(root, kind, fullPaths, options.metadata);
    try {
      const result = await action();
      const mutation = await this.journal.complete(pending);
      return { result, mutation };
    } catch (error) {
      if (pending.undoable) {
        await this.journal.rollbackPending(pending);
      } else {
        await this.journal.abort(pending);
      }
      throw error;
    }
  }

  public extractPatchPaths(input: { chunks?: PatchChunk[]; diff?: string }): string[] {
    if (input.chunks?.length) {
      return Array.from(new Set(input.chunks.map((chunk) => chunk.filePath || chunk.path).filter((item): item is string => Boolean(item))));
    }
    if (!input.diff) return [];
    const paths: string[] = [];
    for (const line of input.diff.split(/\r?\n/)) {
      if (!line.startsWith('+++ ') && !line.startsWith('--- ')) continue;
      let candidate = line.slice(4).split('\t')[0].trim();
      if (!candidate || candidate === '/dev/null') continue;
      candidate = candidate.replace(/^[ab]\//, '');
      paths.push(candidate);
    }
    return Array.from(new Set(paths));
  }

  public async undoOperation(project: string, operationId: string): Promise<MutationRecord> {
    return this.journal.undo(this.projectRoot(project), operationId);
  }

  public async getMutation(project: string, operationId: string): Promise<MutationRecord> {
    return this.journal.get(this.projectRoot(project), operationId);
  }

  private async hash(fullPath: string): Promise<string> {
    const bytes = await fs.readFile(fullPath);
    return crypto.createHash('sha256').update(bytes).digest('hex');
  }

  public async copyFile(options: {
    sourceProject: string;
    sourcePath: string;
    targetProject: string;
    targetPath: string;
    sourceCwd?: string;
    targetCwd?: string;
    expectedSourceHash?: string;
    syncOnly?: boolean;
  }): Promise<{
    changed: boolean;
    sourceHash: string;
    targetHash: string;
    bytesWritten: number;
    operationId?: string;
  }> {
    const source = this.fileService.validateAccess(options.sourcePath, 'read', {
      customCwd: options.sourceCwd,
      project: options.sourceProject,
    });
    const target = this.fileService.validateAccess(options.targetPath, 'write', {
      customCwd: options.targetCwd,
      project: options.targetProject,
    });
    const sourceStat = await fs.lstat(source.fullPath);
    if (!sourceStat.isFile()) throw new Error('copy_file/sync_file supports regular files only.');
    const sourceHash = await this.hash(source.fullPath);
    if (options.expectedSourceHash && sourceHash.toLowerCase() !== options.expectedSourceHash.toLowerCase()) {
      const err: any = new Error(`[SOURCE_HASH_MISMATCH] Expected source hash ${options.expectedSourceHash} but found ${sourceHash}.`);
      err.code = 'SOURCE_HASH_MISMATCH';
      err.category = 'conflict';
      throw err;
    }

    if (fsSync.existsSync(target.fullPath)) {
      const stat = await fs.lstat(target.fullPath);
      if (!stat.isFile()) throw new Error('Target exists but is not a regular file.');
      const currentTargetHash = await this.hash(target.fullPath);
      if (options.syncOnly && currentTargetHash === sourceHash) {
        return { changed: false, sourceHash, targetHash: currentTargetHash, bytesWritten: stat.size };
      }
    }

    const pending = await this.journal.begin(target.projectRoot, options.syncOnly ? 'sync' : 'copy', [target.fullPath], {
      sourceProject: options.sourceProject,
      sourcePath: source.relPath,
      targetProject: options.targetProject,
      targetPath: target.relPath,
    });
    if (!pending.undoable) {
      await this.journal.abort(pending);
      throw new Error('Target is not a regular file and cannot be safely replaced.');
    }

    await fs.mkdir(path.dirname(target.fullPath), { recursive: true });
    const tempPath = path.join(path.dirname(target.fullPath), `.copy.${path.basename(target.fullPath)}.${crypto.randomBytes(5).toString('hex')}`);
    try {
      await fs.copyFile(source.fullPath, tempPath);
      await this.platformAdapter.atomicReplace({ sourcePath: tempPath, targetPath: target.fullPath });
      const targetHash = await this.hash(target.fullPath);
      if (targetHash !== sourceHash) {
        throw new Error('[COPY_VERIFICATION_FAILED] Target hash does not match source after copy.');
      }
      const mutation = await this.journal.complete(pending);
      return {
        changed: true,
        sourceHash,
        targetHash,
        bytesWritten: (await fs.stat(target.fullPath)).size,
        operationId: mutation.operationId,
      };
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      await this.journal.rollbackPending(pending).catch(() => this.journal.abort(pending));
      throw error;
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private decodePointer(pointer: string): string[] {
    if (pointer === '' || pointer === '/') return pointer === '' ? [] : [''];
    if (!pointer.startsWith('/')) {
      const err: any = new Error('[INVALID_CONFIG_PATH] Config patch path must be a JSON Pointer beginning with "/".');
      err.code = 'INVALID_CONFIG_PATH';
      err.category = 'validation';
      throw err;
    }
    return pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  }

  private applyConfigOperations(document: any, operations: ConfigPatchOperation[]): any {
    let root = document;
    for (const operation of operations) {
      const parts = this.decodePointer(operation.path);
      if (parts.length === 0) {
        if (operation.op === 'remove') root = null;
        else root = operation.value;
        continue;
      }
      let cursor = root;
      for (let index = 0; index < parts.length - 1; index++) {
        const key = parts[index];
        if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') {
          if (operation.op === 'remove') {
            const err: any = new Error(`[CONFIG_PATH_NOT_FOUND] Missing config path segment: ${key}`);
            err.code = 'CONFIG_PATH_NOT_FOUND';
            err.category = 'not_found';
            throw err;
          }
          cursor[key] = {};
        }
        cursor = cursor[key];
      }
      const key = parts[parts.length - 1];
      if (operation.op === 'remove') {
        if (Array.isArray(cursor)) {
          const index = Number(key);
          if (!Number.isInteger(index) || index < 0 || index >= cursor.length) throw new Error(`[CONFIG_PATH_NOT_FOUND] Invalid array index: ${key}`);
          cursor.splice(index, 1);
        } else {
          if (!Object.prototype.hasOwnProperty.call(cursor, key)) throw new Error(`[CONFIG_PATH_NOT_FOUND] Config key not found: ${key}`);
          delete cursor[key];
        }
      } else if (Array.isArray(cursor)) {
        if (key === '-') cursor.push(operation.value);
        else {
          const index = Number(key);
          if (!Number.isInteger(index) || index < 0 || index > cursor.length) throw new Error(`[INVALID_CONFIG_PATH] Invalid array index: ${key}`);
          cursor[index] = operation.value;
        }
      } else {
        cursor[key] = operation.value;
      }
    }
    return root;
  }

  public async patchConfig(options: {
    format: 'json' | 'yaml';
    project: string;
    path: string;
    operations: ConfigPatchOperation[];
    cwd?: string;
    expectedBeforeHash?: string;
  }): Promise<{ operationId: string; path: string; beforeHash: string; afterHash: string }> {
    if (!options.operations.length) throw new Error('At least one config patch operation is required.');
    const current = await this.fileService.readFile(options.path, { customCwd: options.cwd, project: options.project });
    const hashed = await this.fileService.hashFile(options.path, { customCwd: options.cwd, project: options.project });
    if (options.expectedBeforeHash && hashed.sha256.toLowerCase() !== options.expectedBeforeHash.toLowerCase()) {
      const err: any = new Error(`[CONCURRENCY_CONFLICT] Expected ${options.expectedBeforeHash} but found ${hashed.sha256}.`);
      err.code = 'CONCURRENCY_CONFLICT';
      err.category = 'conflict';
      throw err;
    }
    let parsed: any;
    try {
      parsed = options.format === 'json' ? JSON.parse(current.content) : parseYaml(current.content);
    } catch (cause: any) {
      const err: any = new Error(`[CONFIG_PARSE_ERROR] ${cause?.message || cause}`);
      err.code = 'CONFIG_PARSE_ERROR';
      err.category = 'validation';
      throw err;
    }
    const patched = this.applyConfigOperations(parsed, options.operations);
    const nextContent = options.format === 'json'
      ? `${JSON.stringify(patched, null, 2)}\n`
      : stringifyYaml(patched);
    const { result, mutation } = await this.journalMutation('config', [options.path], {
      project: options.project,
      cwd: options.cwd,
      metadata: { format: options.format, operationCount: options.operations.length },
    }, () => this.fileService.writeFile(options.path, nextContent, {
      customCwd: options.cwd,
      project: options.project,
      mode: 'replace_if_hash',
      expectedBeforeHash: hashed.sha256,
    }));
    return { operationId: mutation.operationId, path: result.path, beforeHash: result.beforeHash, afterHash: result.afterHash };
  }

  public async applyChangeset(options: {
    project: string;
    cwd?: string;
    operations: FileChangesetOperation[];
  }): Promise<{ success: true; operationId: string; operationCount: number; results: unknown[] }> {
    if (!options.operations.length) throw new Error('Changeset requires at least one operation.');
    const touched: string[] = [];
    for (const operation of options.operations) {
      if (operation.type === 'move') touched.push(operation.sourcePath, operation.destPath);
      else if (operation.type === 'patch') touched.push(...this.extractPatchPaths({ chunks: operation.chunks }));
      else touched.push(operation.path);
    }
    const root = this.projectRoot(options.project, options.cwd);
    const fullPaths = Array.from(new Set(touched)).map((item) => this.resolve(options.project, options.cwd, item));
    const pending = await this.journal.begin(root, 'changeset', fullPaths, { operationCount: options.operations.length });
    if (!pending.undoable) {
      await this.journal.abort(pending);
      const err: any = new Error('[CHANGESET_NON_FILE_TARGET] Changesets support regular files only.');
      err.code = 'CHANGESET_NON_FILE_TARGET';
      err.category = 'validation';
      throw err;
    }

    const results: unknown[] = [];
    try {
      for (const operation of options.operations) {
        if (operation.type === 'write') {
          results.push(await this.fileService.writeFile(operation.path, operation.content, {
            customCwd: options.cwd,
            project: options.project,
            mode: operation.mode,
            expectedBeforeHash: operation.expectedBeforeHash,
          }));
        } else if (operation.type === 'edit') {
          results.push(await this.fileService.editFile(operation.path, operation.targetContent, operation.replacementContent, {
            customCwd: options.cwd,
            project: options.project,
            allowMultiple: operation.allowMultiple,
            expectedBeforeHash: operation.expectedBeforeHash,
          }));
        } else if (operation.type === 'delete') {
          results.push(await this.fileService.deleteFile(operation.path, {
            customCwd: options.cwd,
            project: options.project,
            force: operation.force,
          }));
        } else if (operation.type === 'move') {
          results.push(await this.fileService.moveFile(operation.sourcePath, operation.destPath, {
            customCwd: options.cwd,
            project: options.project,
            overwrite: operation.overwrite,
          }));
        } else {
          results.push(await this.patchService.applyStructuredPatch(operation.chunks, {
            customCwd: options.cwd,
            project: options.project,
          }));
        }
      }
      const record = await this.journal.complete(pending);
      return { success: true, operationId: record.operationId, operationCount: options.operations.length, results };
    } catch (error) {
      await this.journal.rollbackPending(pending);
      throw error;
    }
  }

  public async batchRead(options: {
    project: string;
    cwd?: string;
    operations: Array<
      | { type: 'hash'; path: string }
      | { type: 'read'; path: string; startLine?: number; endLine?: number }
      | { type: 'compare'; pathA: string; pathB: string }
    >;
  }): Promise<{ count: number; results: unknown[] }> {
    const results: unknown[] = [];
    for (const operation of options.operations) {
      if (operation.type === 'hash') {
        results.push(await this.fileService.hashFile(operation.path, { customCwd: options.cwd, project: options.project }));
      } else if (operation.type === 'read') {
        results.push(await this.fileService.readFile(operation.path, {
          customCwd: options.cwd,
          project: options.project,
          startLine: operation.startLine,
          endLine: operation.endLine,
        }));
      } else {
        results.push(await this.fileService.compareFileContent(operation.pathA, operation.pathB, {
          customCwd: options.cwd,
          project: options.project,
        }));
      }
    }
    return { count: results.length, results };
  }
}
