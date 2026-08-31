import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class TunnelBootstrapService {
  private configDir: string;
  private authFile: string;
  private bootstrapSecret: string = '';

  constructor(baseDir: string = process.cwd()) {
    this.configDir = path.resolve(baseDir, 'config');
    this.authFile = path.join(this.configDir, 'tunnel-auth.json');
    this.init();
  }

  private init(): void {
    if (process.env.TUNNEL_BOOTSTRAP_SECRET) {
      this.bootstrapSecret = process.env.TUNNEL_BOOTSTRAP_SECRET.trim();
      return;
    }

    if (!fsSync.existsSync(this.configDir)) {
      fsSync.mkdirSync(this.configDir, { recursive: true });
    }

    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        const data = JSON.parse(raw);
        if (data.bootstrapSecret && typeof data.bootstrapSecret === 'string') {
          this.bootstrapSecret = data.bootstrapSecret.trim();
        }
      } catch {
        // fallback
      }
    }

    if (!this.bootstrapSecret) {
      this.bootstrapSecret = this.generateSecureSecret();
      this.saveSync();
    }
  }

  private generateSecureSecret(): string {
    return 'tsec_' + crypto.randomBytes(32).toString('hex');
  }

  private saveSync(): void {
    let existingData: any = {};
    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        existingData = JSON.parse(raw);
      } catch {}
    }

    existingData.bootstrapSecret = this.bootstrapSecret;
    existingData.updatedAt = new Date().toISOString();
    fsSync.writeFileSync(this.authFile, JSON.stringify(existingData, null, 2), 'utf-8');
  }

  public getSecret(): string {
    return this.bootstrapSecret;
  }

  public rotateSecret(): string {
    this.bootstrapSecret = this.generateSecureSecret();
    this.saveSync();
    return this.bootstrapSecret;
  }

  public validateSecret(provided?: string): boolean {
    if (!provided || typeof provided !== 'string') return false;
    const clean = provided.trim();
    if (!this.bootstrapSecret || !clean) return false;

    const providedBuf = Buffer.from(clean, 'utf-8');
    const secretBuf = Buffer.from(this.bootstrapSecret, 'utf-8');

    if (providedBuf.length !== secretBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(providedBuf, secretBuf);
  }
}
