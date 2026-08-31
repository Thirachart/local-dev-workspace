import { PtyRunner } from './ptyRunner.js';
import { ProcessService } from '../services/processService.js';
import { createPlatformAdapter } from '../platform/platformFactory.js';

export interface CodexRunOptions {
  prompt: string;
  mode?: 'read-only' | 'edit';
  cwd?: string;
  timeoutMs?: number;
  args?: string[];
}

export interface CodexRunResult {
  summary: string;
  exitCode: number | null;
  mode: 'read-only' | 'edit';
  transcript: string;
  mutationsDetected: boolean;
}

interface FingerprintEntry {
  size: number;
  mtimeMs: number;
  sha256: string;
}

export class CodexRunner {
  private ptyRunner = new PtyRunner();

  constructor(
    private baseDir: string,
    private processService?: ProcessService
  ) {}

  public async runCodex(options: CodexRunOptions): Promise<CodexRunResult> {
    const cwd = options.cwd || this.baseDir;
    const mode = options.mode || 'edit';
    const preFiles = await this.captureDirectoryFingerprint(cwd);

    const isWindows = process.platform === 'win32';
    const executable = isWindows ? 'powershell.exe' : 'bash';
    const shellArgs = isWindows
      ? ['-NoProfile', '-Command', `codex ${options.args ? options.args.join(' ') : ''} "${options.prompt}"`]
      : ['-c', `codex ${options.args ? options.args.join(' ') : ''} "${options.prompt}"`];

    const ptyResult = await this.ptyRunner.runPty({
      executable,
      args: shellArgs,
      cwd,
      timeoutMs: options.timeoutMs || 45000,
      input: [
        { afterPattern: 'trust', send: 'y\n' },
        { afterPattern: 'Trust', send: 'y\n' },
        { afterPattern: 'continue', send: 'y\n' },
        { afterPattern: 'Continue', send: 'y\n' },
        { afterPattern: 'proceed', send: 'y\n' },
        { afterPattern: 'Proceed', send: 'y\n' },
        { afterPattern: '[y/N]', send: 'y\n' },
        { afterPattern: '[Y/n]', send: 'y\n' },
        { afterPattern: '(y/n)', send: 'y\n' },
        { afterPattern: '(Y/N)', send: 'y\n' },
        { afterPattern: 'Press Enter', send: '\n' },
        { afterPattern: 'press enter', send: '\n' },
      ],
    });

    const postFiles = await this.captureDirectoryFingerprint(cwd);
    const mutationsDetected = this.hasFingerprintChanged(preFiles, postFiles);

    if (mode === 'read-only' && mutationsDetected) {
      const err: any = new Error('[READ_ONLY_VIOLATION] Filesystem mutation detected during read-only Codex execution.');
      err.category = 'execution';
      err.code = 'READ_ONLY_VIOLATION';
      err.details = { mode: 'read-only', changedFiles: this.getDiffFiles(preFiles, postFiles) };
      throw err;
    }

    return {
      summary: ptyResult.transcript.slice(-400).trim(),
      exitCode: ptyResult.exitCode,
      mode,
      transcript: ptyResult.transcript,
      mutationsDetected,
    };
  }

  private async captureDirectoryFingerprint(dir: string): Promise<Map<string, FingerprintEntry>> {
    const adapter = createPlatformAdapter();
    const observation = await adapter.observeFilesystem(dir, {
      // Deliberately broader than normal workspace snapshots: ignored files are not excluded by Git rules here.
      exclude: ['.git', 'node_modules'],
      includeIgnored: true,
    });
    return new Map(observation.entries.map((entry) => [
      entry.relativePath,
      { size: entry.size, mtimeMs: entry.mtimeMs, sha256: entry.sha256 },
    ]));
  }

  private hasFingerprintChanged(before: Map<string, FingerprintEntry>, after: Map<string, FingerprintEntry>): boolean {
    if (before.size !== after.size) return true;
    for (const [key, value] of before) {
      const next = after.get(key);
      if (!next || next.sha256 !== value.sha256 || next.size !== value.size) return true;
    }
    return false;
  }

  private getDiffFiles(before: Map<string, FingerprintEntry>, after: Map<string, FingerprintEntry>): string[] {
    const diffs = new Set<string>();
    for (const [key, value] of before) {
      const next = after.get(key);
      if (!next || next.sha256 !== value.sha256 || next.size !== value.size) diffs.add(key);
    }
    for (const [key] of after) {
      if (!before.has(key)) diffs.add(key);
    }
    return [...diffs].sort();
  }
}
