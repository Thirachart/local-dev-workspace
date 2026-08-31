import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AtomicReplaceRequest,
  AtomicReplaceResult,
  FileObservation,
  ObservationOptions,
  PlatformAdapter,
  PlatformCapabilities,
} from '../platformAdapter.js';
import { observeFilesystem } from '../capabilityProbe.js';
import { WindowsNativeBridge } from './nativeBridge.js';

const TRANSIENT_RETRY_DELAYS = [10, 30, 60];
const TRANSIENT_CODES = new Set(['ERROR_SHARING_VIOLATION', 'ERROR_LOCK_VIOLATION', 'EBUSY', 'EPERM']);

export class WindowsPlatformAdapter implements PlatformAdapter {
  public readonly platform: NodeJS.Platform = 'win32';

  constructor(private readonly nativeBridge = new WindowsNativeBridge()) {}

  public async getCapabilities(): Promise<PlatformCapabilities> {
    const available = await this.nativeBridge.isAvailable();
    return {
      platform: this.platform,
      atomicReplace: {
        supported: true,
        provider: available ? 'replace-file-w' : 'node-rename-win32',
      },
      pty: {
        supported: true,
        provider: 'conpty',
      },
    };
  }

  public async atomicReplace(request: AtomicReplaceRequest): Promise<AtomicReplaceResult> {
    if (path.dirname(request.sourcePath).toLowerCase() !== path.dirname(request.targetPath).toLowerCase()) {
      const err: any = new Error('[ATOMIC_REPLACE_UNAVAILABLE] Source and target must be in the same directory.');
      err.category = 'execution';
      err.code = 'ATOMIC_REPLACE_UNAVAILABLE';
      throw err;
    }

    if (await this.nativeBridge.isAvailable()) {
      let attempts = 0;
      for (;;) {
        attempts += 1;
        const result = await this.nativeBridge.replaceFile(request.sourcePath, request.targetPath);
        if (result.ok) {
          return { success: true, provider: result.provider || 'replace-file-w', attempts, warnings: [] };
        }

        const code = result.code || 'NATIVE_BRIDGE_FAILED';
        const retryIndex = attempts - 1;
        if (TRANSIENT_CODES.has(code) && retryIndex < TRANSIENT_RETRY_DELAYS.length) {
          await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS[retryIndex]));
          continue;
        }

        const err: any = new Error(`[ATOMIC_REPLACE_FAILED] ReplaceFileW bridge failed: ${result.message || code}`);
        err.category = 'execution';
        err.code = code === 'NATIVE_BRIDGE_MISSING' ? 'ATOMIC_REPLACE_UNAVAILABLE' : 'ATOMIC_REPLACE_FAILED';
        err.details = { originalCode: code, attempts };
        throw err;
      }
    }

    // Direct atomic same-directory replacement via Win32 MoveFileExW (via fs.rename)
    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        await fs.rename(request.sourcePath, request.targetPath);
        return { success: true, provider: 'node-rename-win32', attempts, warnings: [] };
      } catch (nodeErr: any) {
        const code = nodeErr.code || 'UNKNOWN';
        if (code === 'EXDEV') {
          const err: any = new Error('[ATOMIC_REPLACE_UNAVAILABLE] Cross-device rename is not atomic.');
          err.category = 'execution';
          err.code = 'ATOMIC_REPLACE_UNAVAILABLE';
          throw err;
        }
        const retryIndex = attempts - 1;
        if (TRANSIENT_CODES.has(code) && retryIndex < TRANSIENT_RETRY_DELAYS.length) {
          await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS[retryIndex]));
          continue;
        }
        const err: any = new Error(`[ATOMIC_REPLACE_FAILED] Atomic replacement failed: ${nodeErr.message}`);
        err.category = 'execution';
        err.code = 'ATOMIC_REPLACE_FAILED';
        err.details = { originalCode: code, attempts };
        throw err;
      }
    }
  }

  public observeFilesystem(root: string, options?: ObservationOptions): Promise<FileObservation> {
    return observeFilesystem(root, options);
  }

  public normalizePath(input: string): string {
    return path.win32.normalize(input);
  }
}
