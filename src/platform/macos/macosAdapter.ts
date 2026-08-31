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

export class MacOsPlatformAdapter implements PlatformAdapter {
  public readonly platform: NodeJS.Platform = 'darwin';

  public async getCapabilities(): Promise<PlatformCapabilities> {
    return {
      platform: this.platform,
      atomicReplace: {
        supported: true,
        provider: 'posix-rename',
      },
      pty: {
        supported: true,
        provider: 'unix-pty',
      },
    };
  }

  public async atomicReplace(request: AtomicReplaceRequest): Promise<AtomicReplaceResult> {
    if (path.dirname(request.sourcePath) !== path.dirname(request.targetPath)) {
      const err: any = new Error('[ATOMIC_REPLACE_UNAVAILABLE] Source and target must be in the same directory.');
      err.category = 'execution';
      err.code = 'ATOMIC_REPLACE_UNAVAILABLE';
      throw err;
    }

    try {
      await fs.rename(request.sourcePath, request.targetPath);
      return { success: true, provider: 'posix-rename', attempts: 1, warnings: [] };
    } catch (cause: any) {
      const err: any = new Error(`[ATOMIC_REPLACE_FAILED] macOS/POSIX rename failed: ${cause?.message || cause}`);
      err.category = 'execution';
      err.code = cause?.code === 'EXDEV' ? 'ATOMIC_REPLACE_UNAVAILABLE' : 'ATOMIC_REPLACE_FAILED';
      err.details = { originalCode: cause?.code };
      throw err;
    }
  }

  public observeFilesystem(root: string, options?: ObservationOptions): Promise<FileObservation> {
    return observeFilesystem(root, options);
  }

  public normalizePath(input: string): string {
    return path.normalize(input);
  }
}
