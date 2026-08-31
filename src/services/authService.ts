import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type TunnelPreference = {
  preferredTunnel: 'ngrok' | 'openai' | 'none';
  autoStart: boolean;
};

export type OpenApiProfilePreference = {
  profile: 'core' | 'agent' | 'extension' | 'full' | 'custom';
  customTools?: string[];
};

export function resolveStartupTunnel(preference: TunnelPreference): TunnelPreference['preferredTunnel'] {
  return preference.autoStart ? preference.preferredTunnel : 'none';
}

export class AuthService {
  private configDir: string;
  private authFile: string;
  private gitignoreFile: string;
  private apiKey: string = '';
  public isFirstRun: boolean = false;

  constructor(baseDir: string = process.cwd()) {
    this.configDir = path.resolve(baseDir, 'config');
    this.authFile = path.join(this.configDir, 'auth.json');
    this.gitignoreFile = path.resolve(baseDir, '.gitignore');
    this.init();
    this.migrateRemovedIntegrations();
    this.ensureGitignoreProtection();
  }

  private migrateRemovedIntegrations(): void {
    if (!fsSync.existsSync(this.authFile)) return;

    try {
      const data = JSON.parse(fsSync.readFileSync(this.authFile, 'utf-8'));
      let changed = false;

      if (data.preferredTunnel === 'cloudflare') {
        data.preferredTunnel = 'none';
        data.autoStartTunnel = false;
        changed = true;
      }
      if (data.openapiProfile === 'linear') {
        data.openapiProfile = 'core';
        changed = true;
      }
      for (const obsoleteKey of ['cloudflareToken', 'linearApiKey']) {
        if (obsoleteKey in data) {
          delete data[obsoleteKey];
          changed = true;
        }
      }

      if (changed) {
        data.updatedAt = new Date().toISOString();
        fsSync.writeFileSync(this.authFile, JSON.stringify(data, null, 2), 'utf-8');
      }
    } catch {
      // Keep startup resilient when legacy config is malformed.
    }
  }

  private init(): void {
    if (!fsSync.existsSync(this.configDir)) {
      fsSync.mkdirSync(this.configDir, { recursive: true });
    }

    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        const data = JSON.parse(raw);
        if (data.apiKey && typeof data.apiKey === 'string') {
          this.apiKey = data.apiKey.trim();
        }
      } catch {
        // fallback
      }
    }

    // Auto-generate high-entropy key on first run / fresh machine
    if (!this.apiKey) {
      this.isFirstRun = true;
      this.apiKey = this.generateSecureKey();
      this.save();
    }
  }

  private generateSecureKey(): string {
    // 32 bytes = 256 bits of cryptographic entropy (64 hex characters)
    return 'chatdev_' + crypto.randomBytes(32).toString('hex');
  }

  private ensureGitignoreProtection(): void {
    try {
      if (fsSync.existsSync(this.gitignoreFile)) {
        const content = fsSync.readFileSync(this.gitignoreFile, 'utf-8');
        if (!content.includes('config/auth.json') && !content.includes('auth.json')) {
          fsSync.appendFileSync(this.gitignoreFile, '\n# Security Credentials\nconfig/auth.json\nauth.json\n');
        }
      } else {
        fsSync.writeFileSync(this.gitignoreFile, '# Security Credentials\nconfig/auth.json\nauth.json\nnode_modules/\n');
      }
    } catch {
      // ignore
    }
  }

  private save(): void {
    let existingData: any = {};
    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        existingData = JSON.parse(raw);
      } catch {}
    }

    existingData.apiKey = this.apiKey;
    existingData.updatedAt = new Date().toISOString();
    fsSync.writeFileSync(this.authFile, JSON.stringify(existingData, null, 2), 'utf-8');
  }

  public getApiKey(): string {
    return this.apiKey;
  }

  public setApiKey(key: string): string {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new Error('API Key cannot be empty.');
    }
    this.apiKey = key.trim();
    this.save();
    return this.apiKey;
  }

  public resetApiKey(): string {
    this.apiKey = this.generateSecureKey();
    this.save();
    return this.apiKey;
  }

  public getTunnelPreference(): TunnelPreference {
    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        const data = JSON.parse(raw);
        if (data.preferredTunnel === 'none' || data.autoStartTunnel === false) {
          return {
            preferredTunnel: data.preferredTunnel || 'none',
            autoStart: false,
          };
        }
        if (data.preferredTunnel === 'ngrok' || data.preferredTunnel === 'openai') {
          return {
            preferredTunnel: data.preferredTunnel,
            autoStart: true,
          };
        }
      } catch {}
    }
    return {
      preferredTunnel: 'none',
      autoStart: false,
    };
  }

  public setTunnelPreference(pref: { preferredTunnel?: TunnelPreference['preferredTunnel']; autoStart?: boolean }): TunnelPreference {
    let existingData: any = {};
    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        existingData = JSON.parse(raw);
      } catch {}
    }
    if (pref.preferredTunnel !== undefined) {
      existingData.preferredTunnel = pref.preferredTunnel;
      if (pref.preferredTunnel === 'none') {
        existingData.autoStartTunnel = false;
      }
    }
    if (pref.autoStart !== undefined) {
      existingData.autoStartTunnel = pref.autoStart;
    }
    existingData.updatedAt = new Date().toISOString();
    fsSync.writeFileSync(this.authFile, JSON.stringify(existingData, null, 2), 'utf-8');
    return this.getTunnelPreference();
  }

  public getProfilePreference(): OpenApiProfilePreference {
    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        const data = JSON.parse(raw);
        if (['core', 'agent', 'extension', 'full', 'custom'].includes(data.openapiProfile)) {
          return {
            profile: data.openapiProfile,
            customTools: data.customTools,
          };
        }
      } catch {}
    }
    return {
      profile: 'core',
    };
  }

  public setProfilePreference(pref: { profile?: OpenApiProfilePreference['profile']; customTools?: string[] }): OpenApiProfilePreference {
    let existingData: any = {};
    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        existingData = JSON.parse(raw);
      } catch {}
    }
    if (pref.profile !== undefined) {
      existingData.openapiProfile = pref.profile;
    }
    if (pref.customTools !== undefined) {
      existingData.customTools = pref.customTools;
    }
    existingData.updatedAt = new Date().toISOString();
    fsSync.writeFileSync(this.authFile, JSON.stringify(existingData, null, 2), 'utf-8');
    return this.getProfilePreference();
  }

  /**
   * Timing-Safe Constant-Time API Key Verification
   * Prevents side-channel timing attacks when verifying Bearer tokens.
   */
  public validateApiKey(token?: string): boolean {
    if (!token || typeof token !== 'string') return false;
    const clean = token.replace(/^Bearer\s+/i, '').trim();
    if (!this.apiKey || !clean) return false;

    const providedBuffer = Buffer.from(clean, 'utf-8');
    const secretBuffer = Buffer.from(this.apiKey, 'utf-8');

    // Length check must be constant-time or guarded
    if (providedBuffer.length !== secretBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(providedBuffer, secretBuffer);
  }
}
