import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export interface NativeBridgeResult {
  ok: boolean;
  code?: string;
  message?: string;
  provider?: string;
  attempts?: number;
}

function candidateBinaryPaths(): string[] {
  const explicit = process.env.CHAT_DEV_PLATFORM_BRIDGE;
  const exe = process.platform === 'win32' ? 'chat-dev-platform-bridge.exe' : 'chat-dev-platform-bridge';
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const roots = [
    process.cwd(),
    path.resolve(moduleDir, '..'),
    path.resolve(moduleDir, '../../..'),
  ];
  const candidates = roots.flatMap((root) => [
    path.resolve(root, 'native/platform-bridge/target/release', exe),
    path.resolve(root, 'native/platform-bridge/target/debug', exe),
  ]);
  return [explicit, ...candidates].filter((value): value is string => Boolean(value));
}

export class WindowsNativeBridge {
  public resolveBinary(): string | null {
    return candidateBinaryPaths().find((candidate) => fsSync.existsSync(candidate)) ?? null;
  }

  public async isAvailable(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    const binary = this.resolveBinary();
    if (!binary) return false;
    try {
      const result = await this.invoke(binary, ['probe']);
      return result.ok && result.provider === 'replace-file-w';
    } catch {
      return false;
    }
  }

  public async replaceFile(sourcePath: string, targetPath: string): Promise<NativeBridgeResult> {
    if (process.platform !== 'win32') {
      return { ok: false, code: 'UNSUPPORTED_PLATFORM', message: 'Windows native bridge is only available on win32.' };
    }

    const binary = this.resolveBinary();
    if (!binary) {
      return { ok: false, code: 'NATIVE_BRIDGE_MISSING', message: 'Windows platform bridge binary was not found.' };
    }

    return this.invoke(binary, ['replace', sourcePath, targetPath]);
  }

  private async invoke(binary: string, args: string[]): Promise<NativeBridgeResult> {
    await fs.access(binary);
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => {
        const raw = stdout.trim();
        try {
          const parsed = JSON.parse(raw) as NativeBridgeResult;
          resolve(parsed);
        } catch {
          resolve({
            ok: code === 0,
            code: code === 0 ? undefined : 'NATIVE_BRIDGE_FAILED',
            message: stderr.trim() || raw || `Native bridge exited with ${code}`,
          });
        }
      });
    });
  }
}
