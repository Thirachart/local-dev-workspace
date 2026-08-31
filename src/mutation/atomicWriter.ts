import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { CasGuard } from './casGuard.js';
import { ToolWarning } from '../core/types.js';
import type { PlatformAdapter } from '../platform/platformAdapter.js';
import { createPlatformAdapter } from '../platform/platformFactory.js';

export interface AtomicWriteOptions {
  expectedSha256?: string;
  expectedSnapshotId?: string;
  preserveNewline?: boolean;
  encoding?: BufferEncoding;
}

export interface AtomicWriteResult {
  success: boolean;
  beforeSha256: string;
  afterSha256: string;
  bytesWritten: number;
  newline: 'LF' | 'CRLF' | 'none';
  replacementProvider: string;
  warnings: ToolWarning[];
}

export class AtomicWriter {
  private casGuard = new CasGuard();

  constructor(private readonly platformAdapter: PlatformAdapter = createPlatformAdapter()) {}

  public async writeAtomic(
    fullPath: string,
    content: string,
    options?: AtomicWriteOptions
  ): Promise<AtomicWriteResult> {
    const warnings: ToolWarning[] = [];
    const enc = options?.encoding || 'utf-8';
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });

    let newline: 'LF' | 'CRLF' | 'none' = 'none';
    let beforeSha256 = '';

    if (fsSync.existsSync(fullPath)) {
      const existingBuffer = await fs.readFile(fullPath);
      const existingText = existingBuffer.toString('utf-8');
      beforeSha256 = crypto.createHash('sha256').update(existingBuffer).digest('hex');

      if (options?.expectedSha256 && beforeSha256.toLowerCase() !== options.expectedSha256.toLowerCase()) {
        const err: any = new Error(
          `[CONCURRENCY_CONFLICT] Authoritative file hash mismatch before write. Expected "${options.expectedSha256}" but found "${beforeSha256}".`
        );
        err.category = 'conflict';
        err.code = 'CONCURRENCY_CONFLICT';
        throw err;
      }

      if (existingText.includes('\r\n')) {
        newline = 'CRLF';
      } else if (existingText.includes('\n')) {
        newline = 'LF';
      }

      if (options?.preserveNewline !== false && newline === 'CRLF') {
        content = content.replace(/\r?\n/g, '\r\n');
      } else if (options?.preserveNewline !== false && newline === 'LF') {
        content = content.replace(/\r\n/g, '\n');
      }
    }

    const nonce = crypto.randomBytes(6).toString('hex');
    const tempFile = path.join(dir, `.tmp.${path.basename(fullPath)}.${nonce}`);

    let fileHandle: fs.FileHandle | undefined;
    try {
      fileHandle = await fs.open(tempFile, 'w');
      await fileHandle.writeFile(content, enc);
      await fileHandle.sync();
    } catch (cause: any) {
      const err: any = new Error(`[ATOMIC_WRITE_SYNC_FAILED] Failed to write/sync temporary replacement: ${cause?.message || cause}`);
      err.category = 'execution';
      err.code = 'ATOMIC_WRITE_SYNC_FAILED';
      err.details = { originalCode: cause?.code };
      throw err;
    } finally {
      await fileHandle?.close().catch(() => {});
    }

    try {
      if (beforeSha256) {
        const immediateHash = await this.casGuard.computeFileHash(fullPath);
        if (immediateHash !== beforeSha256) {
          const err: any = new Error('[CONCURRENCY_CONFLICT] TOCTOU conflict: File was modified immediately before atomic replace.');
          err.category = 'conflict';
          err.code = 'CONCURRENCY_CONFLICT';
          throw err;
        }
      } else if (fsSync.existsSync(fullPath)) {
        const err: any = new Error('[CONCURRENCY_CONFLICT] Target was created after mutation planning and before atomic replace.');
        err.category = 'conflict';
        err.code = 'CONCURRENCY_CONFLICT';
        throw err;
      }

      const replacement = await this.platformAdapter.atomicReplace({
        sourcePath: tempFile,
        targetPath: fullPath,
      });

      const finalBuffer = await fs.readFile(fullPath);
      const afterSha256 = crypto.createHash('sha256').update(finalBuffer).digest('hex');
      const expectedBuffer = Buffer.from(content, enc);
      const expectedAfterSha256 = crypto.createHash('sha256').update(expectedBuffer).digest('hex');
      if (afterSha256 !== expectedAfterSha256) {
        const err: any = new Error('[POST_WRITE_VERIFICATION_FAILED] Replacement bytes differ from the in-memory mutation result.');
        err.category = 'execution';
        err.code = 'POST_WRITE_VERIFICATION_FAILED';
        throw err;
      }

      return {
        success: replacement.success,
        beforeSha256,
        afterSha256,
        bytesWritten: finalBuffer.byteLength,
        newline,
        replacementProvider: replacement.provider,
        warnings,
      };
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }
}
