import fs from 'node:fs';
import { spawn } from 'node:child_process';

export interface RoslynBridgeStatus {
  available: boolean;
  provider: 'external-roslyn-bridge' | 'syntax-only-fallback';
  reason?: string;
}

export interface RoslynReferenceRequest {
  workspace: string;
  symbol: string;
  files?: string[];
}

export class RoslynBridge {
  constructor(private readonly executable = process.env.CHAT_DEV_ROSLYN_BRIDGE) {}

  public getStatus(): RoslynBridgeStatus {
    if (this.executable && fs.existsSync(this.executable)) {
      return { available: true, provider: 'external-roslyn-bridge' };
    }
    return {
      available: false,
      provider: 'syntax-only-fallback',
      reason: 'No Roslyn bridge executable is configured. C# results must not be labelled semantic.',
    };
  }

  public async findReferences(request: RoslynReferenceRequest): Promise<unknown> {
    const status = this.getStatus();
    if (!status.available || !this.executable) {
      const err: any = new Error('[SEMANTIC_ENGINE_UNAVAILABLE] Roslyn semantic bridge is unavailable.');
      err.category = 'execution';
      err.code = 'SEMANTIC_ENGINE_UNAVAILABLE';
      err.details = status;
      throw err;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(this.executable!, ['find-references'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(stderr || `Roslyn bridge exited with ${code}`));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Roslyn bridge returned invalid JSON.')); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }
}
