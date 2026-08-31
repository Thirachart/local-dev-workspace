import ngrok from '@ngrok/ngrok';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export interface NgrokProfile {
  id: string;
  name: string;
  authtoken: string;
  domain?: string;
  description?: string;
}

export interface NgrokStatus {
  isConnected: boolean;
  url: string | null;
  authtoken: string | null;
  activeProfile?: NgrokProfile | null;
  error?: string;
}

export class NgrokService {
  private listener: any = null;
  private currentUrl: string | null = null;
  private activeProfileId: string = 'default';
  private profiles: NgrokProfile[] = [];
  private configDir: string;
  private authFile: string;

  constructor(baseDir: string = process.cwd()) {
    this.configDir = path.resolve(baseDir, 'config');
    this.authFile = path.join(this.configDir, 'auth.json');
    this.loadProfiles();
  }

  private loadProfiles(): void {
    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.ngrokProfiles) && data.ngrokProfiles.length > 0) {
          this.profiles = data.ngrokProfiles;
          this.activeProfileId = data.activeNgrokProfileId || this.profiles[0].id;
        } else if (data.ngrokToken) {
          // Migration from single token to profiles
          this.profiles = [
            {
              id: 'default',
              name: 'Default Account',
              authtoken: data.ngrokToken,
              domain: data.ngrokDomain || '',
              description: 'Primary Ngrok account',
            },
          ];
          this.activeProfileId = 'default';
        }
      } catch {
        // fallback
      }
    }

    if (this.profiles.length === 0) {
      this.profiles = [
        {
          id: 'default',
          name: 'Default Account',
          authtoken: '',
          domain: '',
          description: 'Primary Ngrok account',
        },
      ];
      this.activeProfileId = 'default';
    }
  }

  private async persist(): Promise<void> {
    let existingData: any = {};
    if (fsSync.existsSync(this.authFile)) {
      try {
        const raw = fsSync.readFileSync(this.authFile, 'utf-8');
        existingData = JSON.parse(raw);
      } catch {}
    }
    const activeProf = this.getActiveProfile();
    existingData.ngrokToken = activeProf ? activeProf.authtoken : '';
    existingData.ngrokDomain = activeProf ? activeProf.domain || '' : '';
    existingData.activeNgrokProfileId = this.activeProfileId;
    existingData.ngrokProfiles = this.profiles;
    existingData.updatedAt = new Date().toISOString();
    await fs.writeFile(this.authFile, JSON.stringify(existingData, null, 2), 'utf-8');
  }

  public getProfiles(): { activeProfileId: string; profiles: NgrokProfile[]; activeProfile: NgrokProfile | null } {
    return {
      activeProfileId: this.activeProfileId,
      profiles: this.profiles,
      activeProfile: this.getActiveProfile(),
    };
  }

  public getActiveProfile(): NgrokProfile | null {
    return this.profiles.find((p) => p.id === this.activeProfileId) || this.profiles[0] || null;
  }

  public async setActiveProfile(id: string): Promise<NgrokProfile> {
    const prof = this.profiles.find((p) => p.id === id);
    if (!prof) {
      throw new Error(`Ngrok Profile with ID "${id}" not found.`);
    }
    this.activeProfileId = id;
    await this.persist();
    return prof;
  }

  public async addProfile(profileData: Omit<NgrokProfile, 'id'>): Promise<NgrokProfile> {
    const newId = 'prof_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const newProf: NgrokProfile = {
      id: newId,
      name: profileData.name.trim() || `Account ${this.profiles.length + 1}`,
      authtoken: (profileData.authtoken || '').trim(),
      domain: (profileData.domain || '').trim(),
      description: (profileData.description || '').trim(),
    };
    this.profiles.push(newProf);
    if (this.profiles.length === 1 || !this.activeProfileId) {
      this.activeProfileId = newId;
    }
    await this.persist();
    return newProf;
  }

  public async updateProfile(id: string, updates: Partial<Omit<NgrokProfile, 'id'>>): Promise<NgrokProfile> {
    const prof = this.profiles.find((p) => p.id === id);
    if (!prof) {
      throw new Error(`Ngrok Profile with ID "${id}" not found.`);
    }
    if (updates.name !== undefined) prof.name = updates.name.trim();
    if (updates.authtoken !== undefined) prof.authtoken = updates.authtoken.trim();
    if (updates.domain !== undefined) prof.domain = updates.domain.trim();
    if (updates.description !== undefined) prof.description = updates.description.trim();
    await this.persist();
    return prof;
  }

  public async deleteProfile(id: string): Promise<void> {
    if (this.profiles.length <= 1) {
      throw new Error('Cannot delete the last remaining Ngrok Profile.');
    }
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.activeProfileId === id) {
      this.activeProfileId = this.profiles[0].id;
    }
    await this.persist();
  }

  public async saveToken(token: string): Promise<void> {
    const active = this.getActiveProfile();
    if (active) {
      active.authtoken = token.trim();
    } else {
      this.profiles.push({
        id: 'default',
        name: 'Default Account',
        authtoken: token.trim(),
        domain: '',
      });
      this.activeProfileId = 'default';
    }
    await this.persist();
  }

  public getAuthtoken(): string {
    const active = this.getActiveProfile();
    return active ? active.authtoken : '';
  }

  public getStatus(): NgrokStatus {
    const active = this.getActiveProfile();
    return {
      isConnected: !!this.listener && !!this.currentUrl,
      url: this.currentUrl,
      authtoken: active ? active.authtoken : null,
      activeProfile: active,
    };
  }

  public async start(port: number = 4100, profileIdOrToken?: string): Promise<NgrokStatus> {
    if (profileIdOrToken && profileIdOrToken.trim()) {
      const trimmed = profileIdOrToken.trim();
      const existing = this.profiles.find((p) => p.id === trimmed);
      if (existing) {
        this.activeProfileId = existing.id;
      } else if (trimmed.length > 20) {
        // Likely a raw authtoken
        await this.saveToken(trimmed);
      }
    }

    const active = this.getActiveProfile();
    if (!active || !active.authtoken) {
      throw new Error('Ngrok Authtoken is required to start the tunnel. Please configure your profile authtoken first.');
    }

    if (this.listener) {
      await this.stop();
    }

    try {
      const forwardOptions: any = {
        addr: port,
        authtoken: active.authtoken,
      };
      if (active.domain && active.domain.trim()) {
        forwardOptions.domain = active.domain.trim();
      }

      this.listener = await ngrok.forward(forwardOptions);
      this.currentUrl = this.listener.url();
      return this.getStatus();
    } catch (err: any) {
      this.listener = null;
      this.currentUrl = null;
      throw new Error(`Failed to start Ngrok: ${err.message}`);
    }
  }

  public async stop(): Promise<NgrokStatus> {
    if (this.listener) {
      try {
        await this.listener.close();
      } catch {}
      this.listener = null;
    }
    this.currentUrl = null;
    return this.getStatus();
  }
}
