import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import {
  OpenAiTunnelProfileStore,
  type OpenAiTunnelProfileSummary,
  type OpenAiTunnelProfilesSnapshot,
} from './openaiTunnelProfileStore.js';

export interface OpenAiTunnelStatus {
  isConnected: boolean;
  processRunning: boolean;
  isReady: boolean;
  readiness: OpenAiTunnelReadiness;
  controlPlanePollReady: boolean | null;
  healthUrl: string;
  activeProfileId: string;
  runningProfileId: string | null;
  tunnelId: string | null;
  runtimeKeyConfigured: boolean;
  mode: 'http' | 'stdio';
  processPid?: number;
  error?: string;
  binaryPath?: string;
}

export type OpenAiTunnelReadiness = 'stopped' | 'starting' | 'ready' | 'not_ready';

export interface OpenAiTunnelReadinessProbe {
  ready: boolean;
  controlPlanePoll: boolean | null;
  error?: string;
}

export interface OpenAiTunnelConfig {
  tunnelId?: string;
  runtimeKey?: string;
  endpoint?: string;
}

export interface OpenAiTunnelRuntime {
  spawnProcess?: typeof spawn;
  initializeProfile?: (binaryPath: string, args: string[], env: NodeJS.ProcessEnv) => void;
  ensureBinary?: () => Promise<string>;
  probeReadiness?: (healthUrl: string) => Promise<OpenAiTunnelReadinessProbe>;
  healthUrl?: string;
  readinessTimeoutMs?: number;
  readinessPollIntervalMs?: number;
  stopTimeoutMs?: number;
  forceKillTimeoutMs?: number;
}

export function resolveOpenAiMcpUrl(port: number = 4100, configuredUrl?: string): string {
  return configuredUrl?.trim() || `http://127.0.0.1:${port}/mcp`;
}

export function isFatalOpenAiTunnelLog(message: string): boolean {
  let structuredLogFound = false;

  for (const line of message.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.level === 'string') {
        structuredLogFound = true;
        if (parsed.level.toUpperCase() === 'ERROR') return true;
      }
    } catch {
      // Fall through to the plain-text process-log check below.
    }
  }

  if (structuredLogFound) return false;
  return /\b(error|failed|fatal|panic)\b/i.test(message);
}

export function buildOpenAiTunnelClientProfileName(
  mode: 'http' | 'stdio',
  profileId: string
): string {
  const safeId = profileId.trim().toLowerCase();
  if (!safeId || !/^[a-z0-9_-]+$/.test(safeId)) {
    throw new Error('Invalid OpenAI tunnel profile ID');
  }
  return `chat-dev-mcp-${mode}-${safeId}`;
}

export class OpenAiTunnelService {
  private child: ChildProcess | null = null;
  private isRunning = false;
  private lastError: string | null = null;
  private runningProfileId: string | null = null;
  private runningMode: 'http' | 'stdio' = 'http';
  private readiness: OpenAiTunnelReadiness = 'stopped';
  private controlPlanePollReady: boolean | null = null;
  private readinessError: string | null = null;
  private readinessRunId = 0;
  private readonly baseDir: string;
  private readonly binDir: string;
  private readonly binaryPath: string;
  private readonly configFile: string;
  private readonly healthUrl: string;
  private profileStore: OpenAiTunnelProfileStore;

  constructor(
    baseDir: string = process.cwd(),
    private readonly runtime: OpenAiTunnelRuntime = {}
  ) {
    this.baseDir = path.resolve(baseDir);
    this.binDir = path.join(this.baseDir, 'bin');
    const isWin = os.platform() === 'win32';
    this.binaryPath = path.join(this.binDir, isWin ? 'tunnel-client.exe' : 'tunnel-client');
    this.configFile = path.join(this.baseDir, 'config', 'tunnel-openai.json');
    this.healthUrl = (runtime.healthUrl?.trim() || 'http://127.0.0.1:8080').replace(/\/+$/, '');
    this.profileStore = new OpenAiTunnelProfileStore(this.configFile);
  }

  /** Compatibility reload for callers that previously refreshed the single-profile config. */
  public loadConfig(): void {
    if (this.isRunning) return;
    this.profileStore = new OpenAiTunnelProfileStore(this.configFile);
  }

  public getProfiles(): OpenAiTunnelProfilesSnapshot {
    return this.profileStore.getSnapshot();
  }

  public async setActiveProfile(id: string): Promise<OpenAiTunnelProfileSummary> {
    if (this.runningProfileId && this.runningProfileId !== id) {
      throw new Error('Stop the running OpenAI tunnel before selecting another profile');
    }
    await this.profileStore.setActiveProfile(id);
    const active = this.profileStore.getSnapshot().activeProfile;
    if (!active) throw new Error(`Unknown OpenAI tunnel profile: ${id}`);
    return active;
  }

  public addProfile(input: {
    name?: string;
    tunnelId?: string;
    runtimeKey?: string;
    description?: string;
  }): Promise<OpenAiTunnelProfileSummary> {
    return this.profileStore.addProfile(input);
  }

  public updateProfile(
    id: string,
    updates: {
      name?: string;
      tunnelId?: string;
      runtimeKey?: string;
      description?: string;
    }
  ): Promise<OpenAiTunnelProfileSummary> {
    return this.profileStore.updateProfile(id, updates);
  }

  public async deleteProfile(id: string): Promise<void> {
    if (this.runningProfileId === id) {
      throw new Error('Cannot delete the running OpenAI tunnel profile');
    }
    await this.profileStore.deleteProfile(id);
  }

  public async saveConfig(tunnelId: string, runtimeKey: string = ''): Promise<void> {
    await this.profileStore.saveActiveCredentials(tunnelId, runtimeKey);
  }

  public getStatus(): OpenAiTunnelStatus {
    const snapshot = this.profileStore.getSnapshot();
    const processRunning = this.isRunning && !!this.child;
    const isReady = processRunning && this.readiness === 'ready';
    const relevantProfile = this.runningProfileId
      ? this.profileStore.getProfile(this.runningProfileId)
      : this.profileStore.getActiveProfile();
    return {
      isConnected: isReady,
      processRunning,
      isReady,
      readiness: processRunning ? this.readiness : 'stopped',
      controlPlanePollReady: processRunning ? this.controlPlanePollReady : null,
      healthUrl: this.healthUrl,
      activeProfileId: snapshot.activeProfileId,
      runningProfileId: processRunning ? this.runningProfileId : null,
      tunnelId: relevantProfile?.tunnelId || null,
      runtimeKeyConfigured: !!relevantProfile?.runtimeKey,
      mode: processRunning ? this.runningMode : 'http',
      processPid: processRunning ? this.child?.pid : undefined,
      error: this.lastError || (processRunning ? this.readinessError || undefined : undefined),
      binaryPath: fsSync.existsSync(this.binaryPath) ? this.binaryPath : undefined,
    };
  }

  private async probeLocalReadiness(): Promise<OpenAiTunnelReadinessProbe> {
    const readyResponse = await this.requestHealth('/readyz');
    if (readyResponse.statusCode !== 200) {
      return {
        ready: false,
        controlPlanePoll: null,
        error: `tunnel-client /readyz returned HTTP ${readyResponse.statusCode}`,
      };
    }

    const metricsResponse = await this.requestHealth('/metrics');
    if (metricsResponse.statusCode !== 200) {
      return {
        ready: false,
        controlPlanePoll: null,
        error: `tunnel-client /metrics returned HTTP ${metricsResponse.statusCode}`,
      };
    }

    const pollMatch = metricsResponse.body.match(
      /^\s*commands_poll_last_successful_timestamp_seconds(?:\{[^}\r\n]*\})?\s+([0-9.eE+-]+)\s*$/m
    );
    if (!pollMatch) {
      return {
        ready: false,
        controlPlanePoll: null,
        error: 'control-plane poll status unavailable from tunnel-client metrics',
      };
    }

    const controlPlanePoll = Number(pollMatch[1]) > 0;
    return {
      ready: controlPlanePoll,
      controlPlanePoll,
      error: controlPlanePoll ? undefined : 'control-plane poll has not completed',
    };
  }

  private requestHealth(pathname: string): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let body = '';
      const request = http.get(new URL(pathname, `${this.healthUrl}/`), (response) => {
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          if (body.length >= 256 * 1024) return;
          body += String(chunk).slice(0, 256 * 1024 - body.length);
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({ statusCode: response.statusCode || 0, body });
        });
        response.on('error', (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
      });
      request.setTimeout(1500, () => request.destroy(new Error(`health probe timed out: ${pathname}`)));
      request.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });
  }

  private async refreshReadiness(child: ChildProcess): Promise<void> {
    if (this.child !== child || !this.isRunning) return;

    let probe: OpenAiTunnelReadinessProbe;
    try {
      probe = this.runtime.probeReadiness
        ? await this.runtime.probeReadiness(this.healthUrl)
        : await this.probeLocalReadiness();
    } catch (error: any) {
      probe = {
        ready: false,
        controlPlanePoll: null,
        error: `tunnel-client readiness probe failed: ${error?.message || String(error)}`,
      };
    }

    if (this.child !== child || !this.isRunning) return;

    const isReady = probe.ready && probe.controlPlanePoll !== false;
    this.controlPlanePollReady = probe.controlPlanePoll;
    if (isReady) {
      this.readiness = 'ready';
      this.readinessError = null;
    } else {
      if (this.readiness === 'not_ready') {
        this.readinessError = probe.error || (probe.controlPlanePoll === false
          ? 'control-plane poll has not completed'
          : 'tunnel-client is not ready');
      } else {
        this.readiness = 'starting';
        this.readinessError = null;
      }
    }
  }

  private async monitorReadiness(child: ChildProcess): Promise<void> {
    const runId = this.readinessRunId;
    const timeoutMs = Math.max(0, this.runtime.readinessTimeoutMs ?? 45_000);
    const intervalMs = Math.max(50, this.runtime.readinessPollIntervalMs ?? 500);
    const deadline = Date.now() + timeoutMs;
    let timedOut = false;

    while (this.child === child && this.isRunning && this.readinessRunId === runId) {
      await this.refreshReadiness(child);
      if (this.readiness === 'ready') return;
      if (!timedOut && Date.now() >= deadline) {
        timedOut = true;
      }
      if (timedOut && this.child === child && this.isRunning && this.readinessRunId === runId) {
        this.readiness = 'not_ready';
        this.readinessError ||= `tunnel-client did not become ready within ${timeoutMs}ms`;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timedOut ? intervalMs : Math.min(intervalMs, Math.max(1, deadline - Date.now())));
        timer.unref?.();
      });
    }
  }

  public async ensureBinary(): Promise<string> {
    try {
      const isWin = os.platform() === 'win32';
      const whichCmd = isWin ? 'where' : 'which';
      const pathResult = execFileSync(whichCmd, ['tunnel-client'], { encoding: 'utf-8' }).trim();
      if (pathResult) {
        return pathResult.split(/\r?\n/)[0];
      }
    } catch {}

    if (fsSync.existsSync(this.binaryPath)) {
      return this.binaryPath;
    }

    if (!fsSync.existsSync(this.binDir)) {
      await fs.mkdir(this.binDir, { recursive: true });
    }

    const sysPlatform = os.platform();
    const sysArch = os.arch();
    let osName = 'linux';
    if (sysPlatform === 'win32') osName = 'windows';
    else if (sysPlatform === 'darwin') osName = 'darwin';

    let archName = 'amd64';
    if (sysArch === 'arm64') archName = 'arm64';

    const zipName = `tunnel-client-v0.0.11-${osName}-${archName}.zip`;
    const downloadUrl = `https://github.com/openai/tunnel-client/releases/download/v0.0.11/${zipName}`;
    const zipPath = path.join(this.binDir, 'tunnel-client.zip');

    console.log(`📥 [OpenAI Tunnel] Downloading tunnel-client binary from ${downloadUrl}...`);

    await new Promise<void>((resolve, reject) => {
      const fileStream = fsSync.createWriteStream(zipPath);
      https.get(downloadUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          https.get(response.headers.location!, (redirectRes) => {
            redirectRes.pipe(fileStream);
            fileStream.on('finish', () => {
              fileStream.close();
              resolve();
            });
          }).on('error', reject);
        } else if (response.statusCode === 200) {
          response.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
        } else {
          reject(new Error(`Failed to download binary: HTTP ${response.statusCode}`));
        }
      }).on('error', reject);
    });

    if (sysPlatform === 'win32') {
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${this.binDir.replace(/'/g, "''")}' -Force`,
      ]);
    } else {
      execFileSync('unzip', ['-o', zipPath, '-d', this.binDir]);
      await fs.chmod(this.binaryPath, 0o755);
    }
    await fs.unlink(zipPath).catch(() => {});

    console.log(`✅ [OpenAI Tunnel] Installed tunnel-client binary at ${this.binaryPath}`);
    return this.binaryPath;
  }

  public async startTunnel(options?: {
    mode?: 'http' | 'stdio';
    port?: number;
    sseUrl?: string;
    profileId?: string;
  }): Promise<OpenAiTunnelStatus> {
    const requestedProfileId = options?.profileId?.trim() || this.profileStore.getSnapshot().activeProfileId;
    const requestedProfile = this.profileStore.getProfile(requestedProfileId);
    if (!requestedProfile) {
      throw new Error(`Unknown OpenAI tunnel profile: ${requestedProfileId}`);
    }

    if (this.isRunning && this.runningProfileId === requestedProfileId && this.child) {
      return this.getStatus();
    }

    if (!requestedProfile.tunnelId || !requestedProfile.runtimeKey) {
      throw new Error('Missing OpenAI tunnel ID or runtime key for the selected profile');
    }

    if (this.isRunning && this.child) {
      await this.stopTunnel();
    }

    if (this.profileStore.getSnapshot().activeProfileId !== requestedProfileId) {
      await this.profileStore.setActiveProfile(requestedProfileId);
    }

    const profile = this.profileStore.getProfile(requestedProfileId);
    if (!profile) {
      throw new Error(`Unknown OpenAI tunnel profile: ${requestedProfileId}`);
    }

    const binPath = this.runtime.ensureBinary
      ? await this.runtime.ensureBinary()
      : await this.ensureBinary();
    const mode = options?.mode || 'http';
    const port = options?.port || 4100;
    const mcpUrl = resolveOpenAiMcpUrl(port, options?.sseUrl);
    const profileName = buildOpenAiTunnelClientProfileName(mode, profile.id);
    const nodeBin = path.join(this.baseDir, 'dist', 'index.js').replace(/\\/g, '/');
    const initArgs = mode === 'stdio'
      ? ['init', '--sample', 'sample_mcp_stdio_local', '--profile', profileName, '--tunnel-id', profile.tunnelId, '--mcp-command', `node "${nodeBin}"`, '--force']
      : ['init', '--profile', profileName, '--tunnel-id', profile.tunnelId, '--mcp-server-url', mcpUrl, '--force'];
    const env = { ...process.env, CONTROL_PLANE_API_KEY: profile.runtimeKey };

    try {
      if (this.runtime.initializeProfile) {
        this.runtime.initializeProfile(binPath, initArgs, env);
      } else {
        execFileSync(binPath, initArgs, { env, stdio: 'pipe' });
      }
    } catch {
      // Preserve existing behavior: tunnel-client init warnings do not prevent a run attempt.
    }

    this.lastError = null;
    const spawnProcess = this.runtime.spawnProcess || spawn;
    const child = spawnProcess(binPath, ['run', '--profile', profileName], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child = child;
    this.isRunning = true;
    this.runningProfileId = profile.id;
    this.runningMode = mode;
    this.readinessRunId += 1;
    this.readiness = 'starting';
    this.controlPlanePollReady = null;
    this.readinessError = null;

    child.stdout?.on('data', (chunk) => {
      const msg = chunk.toString();
      if (isFatalOpenAiTunnelLog(msg)) this.lastError = msg.trim();
    });
    child.stderr?.on('data', (chunk) => {
      const msg = chunk.toString();
      if (isFatalOpenAiTunnelLog(msg)) this.lastError = msg.trim();
    });
    child.on('error', (error) => {
      if (this.child === child) {
        this.lastError = error.message;
        this.clearRunningChild(child);
      }
    });
    child.on('exit', (code) => {
      if (this.child === child) {
        if (code !== 0 && code !== null) {
          this.lastError = `tunnel-client process exited with code ${code}`;
        }
        this.clearRunningChild(child);
      }
    });

    console.log(`🟢 [OpenAI Tunnel] Started tunnel-client daemon (Profile: ${profile.id}, Mode: ${mode})`);
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 500));
      if (this.child !== child || !this.isRunning) break;
      await this.refreshReadiness(child);
      if (this.readiness === 'ready') break;
    }

    if (this.child === child && this.isRunning && this.getStatus().readiness !== 'ready') {
      void this.monitorReadiness(child);
    }
    return this.getStatus();
  }

  public async stopTunnel(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.isRunning = false;
      this.runningProfileId = null;
      this.resetReadiness();
      return;
    }

    if (child.exitCode !== null) {
      this.clearRunningChild(child);
      return;
    }

    const gracefulTimeoutMs = this.runtime.stopTimeoutMs ?? 3000;
    const forceKillTimeoutMs = this.runtime.forceKillTimeoutMs ?? 1000;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let gracefulTimer: NodeJS.Timeout | undefined;
      let forceTimer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (gracefulTimer) clearTimeout(gracefulTimer);
        if (forceTimer) clearTimeout(forceTimer);
        child.removeListener('exit', onTerminated);
        child.removeListener('close', onTerminated);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.clearRunningChild(child);
        console.log('🔴 [OpenAI Tunnel] Stopped tunnel-client daemon');
        resolve();
      };
      const onTerminated = () => finish();

      child.once('exit', onTerminated);
      child.once('close', onTerminated);

      const signaled = child.kill('SIGTERM');
      if (!signaled && child.exitCode !== null) {
        finish();
        return;
      }

      gracefulTimer = setTimeout(() => {
        if (settled) return;
        child.kill('SIGKILL');
        forceTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('OpenAI tunnel process did not exit after forced termination'));
        }, forceKillTimeoutMs);
      }, gracefulTimeoutMs);
    });
  }

  private clearRunningChild(child: ChildProcess): void {
    if (this.child !== child) return;
    this.child = null;
    this.isRunning = false;
    this.runningProfileId = null;
    this.resetReadiness();
  }

  private resetReadiness(): void {
    this.readinessRunId += 1;
    this.readiness = 'stopped';
    this.controlPlanePollReady = null;
    this.readinessError = null;
  }
}
