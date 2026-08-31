import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface OpenAiTunnelProfile {
  id: string;
  name: string;
  tunnelId: string;
  runtimeKey: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenAiTunnelProfileSummary {
  id: string;
  name: string;
  tunnelId: string;
  runtimeKeyConfigured: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenAiTunnelProfilesSnapshot {
  activeProfileId: string;
  profiles: OpenAiTunnelProfileSummary[];
  activeProfile: OpenAiTunnelProfileSummary | null;
}

interface PersistedOpenAiTunnelProfiles {
  version: 2;
  activeProfileId: string;
  profiles: OpenAiTunnelProfile[];
}

interface LegacyOpenAiTunnelConfig {
  tunnelId?: unknown;
  runtimeKey?: unknown;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneProfile(profile: OpenAiTunnelProfile): OpenAiTunnelProfile {
  return { ...profile };
}

function summarize(profile: OpenAiTunnelProfile): OpenAiTunnelProfileSummary {
  const { runtimeKey: _runtimeKey, ...rest } = profile;
  return { ...rest, runtimeKeyConfigured: !!profile.runtimeKey };
}

export function buildOpenAiTunnelTempFile(configFile: string): string {
  return `${configFile}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
}

export class OpenAiTunnelProfileStore {
  private activeProfileId: string;
  private profiles: OpenAiTunnelProfile[];
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly configFile: string,
    env: Record<string, string | undefined> = process.env
  ) {
    const loaded = this.load(env);
    this.activeProfileId = loaded.activeProfileId;
    this.profiles = loaded.profiles;
  }

  public getSnapshot(): OpenAiTunnelProfilesSnapshot {
    const profiles = this.profiles.map(summarize);
    const activeProfile = profiles.find((profile) => profile.id === this.activeProfileId) || null;
    return {
      activeProfileId: this.activeProfileId,
      profiles,
      activeProfile,
    };
  }

  public getActiveProfile(): OpenAiTunnelProfile | null {
    const profile = this.profiles.find((candidate) => candidate.id === this.activeProfileId);
    return profile ? cloneProfile(profile) : null;
  }

  public getProfile(id: string): OpenAiTunnelProfile | null {
    const profile = this.profiles.find((candidate) => candidate.id === id);
    return profile ? cloneProfile(profile) : null;
  }

  public setActiveProfile(id: string): Promise<OpenAiTunnelProfile> {
    return this.mutate(async () => {
      const profile = this.requireProfile(id);
      this.activeProfileId = profile.id;
      await this.persist();
      return cloneProfile(profile);
    });
  }

  public addProfile(input: {
    name?: string;
    tunnelId?: string;
    runtimeKey?: string;
    description?: string;
  }): Promise<OpenAiTunnelProfileSummary> {
    return this.mutate(async () => {
      const now = new Date().toISOString();
      const name = cleanString(input.name) || 'OpenAI Tunnel';
      const profile: OpenAiTunnelProfile = {
        id: this.createProfileId(name),
        name,
        tunnelId: cleanString(input.tunnelId),
        runtimeKey: cleanString(input.runtimeKey),
        description: cleanString(input.description) || undefined,
        createdAt: now,
        updatedAt: now,
      };
      this.profiles.push(profile);
      await this.persist();
      return summarize(profile);
    });
  }

  public updateProfile(
    id: string,
    updates: Partial<Omit<OpenAiTunnelProfile, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<OpenAiTunnelProfileSummary> {
    return this.mutate(async () => {
      const profile = this.requireProfile(id);
      if (updates.name !== undefined) {
        const name = cleanString(updates.name);
        if (!name) throw new Error('Profile name is required');
        profile.name = name;
      }
      if (updates.tunnelId !== undefined) profile.tunnelId = cleanString(updates.tunnelId);
      if (updates.runtimeKey !== undefined && cleanString(updates.runtimeKey)) {
        profile.runtimeKey = cleanString(updates.runtimeKey);
      }
      if (updates.description !== undefined) {
        profile.description = cleanString(updates.description) || undefined;
      }
      profile.updatedAt = new Date().toISOString();
      await this.persist();
      return summarize(profile);
    });
  }

  public deleteProfile(id: string): Promise<void> {
    return this.mutate(async () => {
      this.requireProfile(id);
      if (this.profiles.length <= 1) {
        throw new Error('Cannot delete the last OpenAI tunnel profile');
      }
      this.profiles = this.profiles.filter((profile) => profile.id !== id);
      if (this.activeProfileId === id) {
        this.activeProfileId = this.profiles[0].id;
      }
      await this.persist();
    });
  }

  public saveActiveCredentials(tunnelId: string, runtimeKey?: string): Promise<void> {
    return this.mutate(async () => {
      const profile = this.requireProfile(this.activeProfileId);
      profile.tunnelId = cleanString(tunnelId);
      const nextRuntimeKey = cleanString(runtimeKey);
      if (nextRuntimeKey) profile.runtimeKey = nextRuntimeKey;
      profile.updatedAt = new Date().toISOString();
      await this.persist();
    });
  }

  private load(env: Record<string, string | undefined>): {
    activeProfileId: string;
    profiles: OpenAiTunnelProfile[];
  } {
    let parsed: unknown = null;
    if (fsSync.existsSync(this.configFile)) {
      try {
        parsed = JSON.parse(fsSync.readFileSync(this.configFile, 'utf8'));
      } catch {
        parsed = null;
      }
    }

    if (parsed && typeof parsed === 'object') {
      const data = parsed as Partial<PersistedOpenAiTunnelProfiles> & LegacyOpenAiTunnelConfig;
      if (data.version === 2 && Array.isArray(data.profiles)) {
        const profiles = data.profiles
          .map((profile) => this.normalizePersistedProfile(profile))
          .filter((profile): profile is OpenAiTunnelProfile => !!profile);
        if (profiles.length > 0) {
          const requestedActive = cleanString(data.activeProfileId);
          return {
            activeProfileId: profiles.some((profile) => profile.id === requestedActive)
              ? requestedActive
              : profiles[0].id,
            profiles,
          };
        }
      }
    }

    const legacy = (parsed && typeof parsed === 'object' ? parsed : {}) as LegacyOpenAiTunnelConfig;
    const now = new Date().toISOString();
    const tunnelId = cleanString(env.OPENAI_TUNNEL_ID) || cleanString(legacy.tunnelId);
    const runtimeKey = cleanString(env.OPENAI_RUNTIME_KEY) || cleanString(legacy.runtimeKey);
    return {
      activeProfileId: 'default',
      profiles: [{
        id: 'default',
        name: 'Default',
        tunnelId,
        runtimeKey,
        createdAt: now,
        updatedAt: now,
      }],
    };
  }

  private normalizePersistedProfile(value: unknown): OpenAiTunnelProfile | null {
    if (!value || typeof value !== 'object') return null;
    const profile = value as Partial<OpenAiTunnelProfile>;
    const id = cleanString(profile.id);
    if (!id || !/^[a-z0-9_-]+$/.test(id)) return null;
    const now = new Date().toISOString();
    return {
      id,
      name: cleanString(profile.name) || id,
      tunnelId: cleanString(profile.tunnelId),
      runtimeKey: cleanString(profile.runtimeKey),
      description: cleanString(profile.description) || undefined,
      createdAt: cleanString(profile.createdAt) || now,
      updatedAt: cleanString(profile.updatedAt) || now,
    };
  }

  private requireProfile(id: string): OpenAiTunnelProfile {
    const normalizedId = cleanString(id);
    const profile = this.profiles.find((candidate) => candidate.id === normalizedId);
    if (!profile) throw new Error(`Unknown OpenAI tunnel profile: ${normalizedId || id}`);
    return profile;
  }

  private createProfileId(name: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'profile';
    let id = `${slug}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    while (this.profiles.some((profile) => profile.id === id)) {
      id = `${slug}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    }
    return id;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(async () => {
      const beforeProfiles = this.profiles.map(cloneProfile);
      const beforeActive = this.activeProfileId;
      try {
        return await operation();
      } catch (error) {
        this.profiles = beforeProfiles;
        this.activeProfileId = beforeActive;
        throw error;
      }
    });
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.configFile), { recursive: true });
    const tempFile = buildOpenAiTunnelTempFile(this.configFile);
    const data: PersistedOpenAiTunnelProfiles = {
      version: 2,
      activeProfileId: this.activeProfileId,
      profiles: this.profiles.map(cloneProfile),
    };
    try {
      await fs.writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      await fs.rename(tempFile, this.configFile);
    } catch (error) {
      await fs.rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
