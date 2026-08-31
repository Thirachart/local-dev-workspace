import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { ChildProcess } from 'node:child_process';
import {
  OpenAiTunnelService,
  buildOpenAiTunnelClientProfileName,
  isFatalOpenAiTunnelLog,
  resolveOpenAiMcpUrl,
} from '../src/services/openaiTunnelService.js';
import {
  OpenAiTunnelProfileStore,
  buildOpenAiTunnelTempFile,
} from '../src/services/openaiTunnelProfileStore.js';

class FakeChildProcess extends EventEmitter {
  public stdout = new PassThrough();
  public stderr = new PassThrough();
  public killed = false;
  public exitCode: number | null = null;
  public pid = Math.floor(Math.random() * 10000) + 1000;
  public signals: string[] = [];
  public onForceKill?: () => void;

  public kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    this.killed = true;
    this.signals.push(String(signal));
    if (signal === 'SIGKILL') this.onForceKill?.();
    return true;
  }

  public exit(code = 0): void {
    this.exitCode = code;
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

async function makeTempRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('resolveOpenAiMcpUrl defaults to the streamable HTTP MCP endpoint', () => {
  assert.equal(resolveOpenAiMcpUrl(4100), 'http://127.0.0.1:4100/mcp');
});

test('resolveOpenAiMcpUrl normalizes the legacy SSE route to the MCP endpoint', () => {
  assert.equal(resolveOpenAiMcpUrl(4100, 'http://127.0.0.1:4100/sse'), 'http://127.0.0.1:4100/sse');
});

test('isFatalOpenAiTunnelLog ignores structured INFO output and catches real errors', () => {
  assert.equal(isFatalOpenAiTunnelLog('{"level":"INFO","msg":"connected without error"}'), false);
  assert.equal(isFatalOpenAiTunnelLog('{"level":"ERROR","msg":"connection failed"}'), true);
  assert.equal(isFatalOpenAiTunnelLog('fatal: tunnel failed'), true);
});

test('migrates a legacy OpenAI config to a default profile without exposing its key', async () => {
  const root = await makeTempRoot('openai-profile-store-');
  try {
    const configDir = path.join(root, 'config');
    await fs.mkdir(configDir, { recursive: true });
    const configFile = path.join(configDir, 'tunnel-openai.json');
    await fs.writeFile(
      configFile,
      JSON.stringify({ tunnelId: 'tunnel_legacy', runtimeKey: 'secret_legacy' }),
      'utf8'
    );

    const store = new OpenAiTunnelProfileStore(configFile, {});
    const snapshot = store.getSnapshot();

    assert.equal(snapshot.activeProfileId, 'default');
    assert.equal(snapshot.profiles[0].tunnelId, 'tunnel_legacy');
    assert.equal(snapshot.profiles[0].runtimeKeyConfigured, true);
    assert.equal('runtimeKey' in snapshot.profiles[0], false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('version 2 profiles remain authoritative over environment fallback', async () => {
  const root = await makeTempRoot('openai-profile-v2-');
  try {
    const configDir = path.join(root, 'config');
    await fs.mkdir(configDir, { recursive: true });
    const configFile = path.join(configDir, 'tunnel-openai.json');
    const now = new Date().toISOString();
    await fs.writeFile(configFile, JSON.stringify({
      version: 2,
      activeProfileId: 'saved',
      profiles: [{
        id: 'saved',
        name: 'Saved',
        tunnelId: 'tunnel_saved',
        runtimeKey: 'secret_saved',
        createdAt: now,
        updatedAt: now,
      }],
    }), 'utf8');

    const store = new OpenAiTunnelProfileStore(configFile, {
      OPENAI_TUNNEL_ID: 'tunnel_env',
      OPENAI_RUNTIME_KEY: 'secret_env',
    });
    assert.equal(store.getActiveProfile()?.tunnelId, 'tunnel_saved');
    assert.equal(store.getActiveProfile()?.runtimeKey, 'secret_saved');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('profile store serializes concurrent mutations and uses unique temp paths', async () => {
  const root = await makeTempRoot('openai-profile-concurrent-');
  try {
    const configFile = path.join(root, 'config', 'tunnel-openai.json');
    const store = new OpenAiTunnelProfileStore(configFile, {});
    const firstTemp = buildOpenAiTunnelTempFile(configFile);
    const secondTemp = buildOpenAiTunnelTempFile(configFile);
    assert.notEqual(firstTemp, secondTemp);

    const [a, b] = await Promise.all([
      store.addProfile({ name: 'Alpha', tunnelId: 'tunnel_a', runtimeKey: 'secret_a' }),
      store.addProfile({ name: 'Beta', tunnelId: 'tunnel_b', runtimeKey: 'secret_b' }),
    ]);
    const persisted = JSON.parse(await fs.readFile(configFile, 'utf8'));
    assert.equal(persisted.version, 2);
    assert.ok(persisted.profiles.some((profile: { id: string }) => profile.id === a.id));
    assert.ok(persisted.profiles.some((profile: { id: string }) => profile.id === b.id));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('profile CRUD preserves blank runtime key and protects the last profile', async () => {
  const root = await makeTempRoot('openai-profile-crud-');
  try {
    const store = new OpenAiTunnelProfileStore(path.join(root, 'config', 'tunnel-openai.json'), {});
    const work = await store.addProfile({ name: 'Work', tunnelId: 'tunnel_work', runtimeKey: 'secret_work' });
    await store.setActiveProfile(work.id);
    await store.updateProfile(work.id, { name: 'Work Updated', runtimeKey: '' });
    assert.equal(store.getProfile(work.id)?.runtimeKey, 'secret_work');
    assert.equal(store.getProfile(work.id)?.name, 'Work Updated');

    await store.deleteProfile('default');
    await assert.rejects(() => store.deleteProfile(work.id), /last OpenAI tunnel profile/i);
    await assert.rejects(() => store.setActiveProfile('missing'), /Unknown OpenAI tunnel profile/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('returns non-secret status and tracks active profile separately from running state', async () => {
  const root = await makeTempRoot('openai-status-');
  try {
    const service = new OpenAiTunnelService(root);
    const profile = await service.addProfile({ name: 'Work', tunnelId: 'tunnel_work', runtimeKey: 'secret_work' });
    await service.setActiveProfile(profile.id);
    const status = service.getStatus();

    assert.equal(status.activeProfileId, profile.id);
    assert.equal(status.runningProfileId, null);
    assert.equal(status.processRunning, false);
    assert.equal(status.isReady, false);
    assert.equal(status.readiness, 'stopped');
    assert.equal(status.tunnelId, 'tunnel_work');
    assert.equal(status.runtimeKeyConfigured, true);
    assert.equal('runtimeKey' in status, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('does not report a live child process as a connected tunnel before readiness', async () => {
  const root = await makeTempRoot('openai-readiness-');
  try {
    const child = new FakeChildProcess();
    const service = new OpenAiTunnelService(root, {
      ensureBinary: async () => '/fake/tunnel-client',
      initializeProfile: () => undefined,
      spawnProcess: (() => child as unknown as ChildProcess) as typeof import('node:child_process').spawn,
      probeReadiness: async () => ({
        ready: false,
        controlPlanePoll: false,
        error: 'control-plane poll has not completed',
      }),
    });
    const profile = await service.addProfile({
      name: 'Readiness',
      tunnelId: 'tunnel_readiness',
      runtimeKey: 'secret_readiness',
    });

    const status = await service.startTunnel({ profileId: profile.id });

    assert.equal(status.processRunning, true);
    assert.equal(status.isConnected, false);
    assert.equal(status.isReady, false);
    assert.equal(status.readiness, 'starting');
    assert.equal(status.controlPlanePollReady, false);

    child.exit(0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('buildOpenAiTunnelClientProfileName is unique and shell-safe', () => {
  const first = buildOpenAiTunnelClientProfileName('http', 'prof_work');
  const second = buildOpenAiTunnelClientProfileName('http', 'prof_home');
  assert.equal(first, 'chat-dev-mcp-http-prof_work');
  assert.equal(buildOpenAiTunnelClientProfileName('stdio', 'prof_work'), 'chat-dev-mcp-stdio-prof_work');
  assert.notEqual(first, second);
  assert.match(first, /^[a-z0-9_-]+$/);
  assert.throws(() => buildOpenAiTunnelClientProfileName('http', 'bad;profile'));
});

test('switches profiles only after the old daemon exits and forwards init args separately', async () => {
  const root = await makeTempRoot('openai-switch-');
  try {
    const children = [new FakeChildProcess(), new FakeChildProcess()];
    const initCalls: Array<{ binary: string; args: string[] }> = [];
    let spawnIndex = 0;
    const service = new OpenAiTunnelService(root, {
      ensureBinary: async () => '/fake/tunnel-client',
      initializeProfile: (binary, args) => initCalls.push({ binary, args: [...args] }),
      spawnProcess: (() => children[spawnIndex++] as unknown as ChildProcess) as typeof import('node:child_process').spawn,
      probeReadiness: async () => ({ ready: true, controlPlanePoll: true }),
      stopTimeoutMs: 100,
      forceKillTimeoutMs: 100,
    });
    const a = await service.addProfile({ name: 'A', tunnelId: 'tunnel_a', runtimeKey: 'secret_a' });
    const b = await service.addProfile({ name: 'B', tunnelId: 'tunnel_b', runtimeKey: 'secret_b' });

    await service.startTunnel({ profileId: a.id });
    assert.equal(initCalls.length, 1);
    assert.equal(initCalls[0].binary, '/fake/tunnel-client');
    assert.ok(initCalls[0].args.includes('tunnel_a'));

    const switching = service.startTunnel({ profileId: b.id });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(children[0].signals, ['SIGTERM']);
    assert.equal(initCalls.length, 1, 'new profile must not initialize before old child exits');

    children[0].exit(0);
    const status = await switching;
    assert.equal(initCalls.length, 2);
    assert.ok(initCalls[1].args.includes('tunnel_b'));
    assert.equal(status.runningProfileId, b.id);
    assert.equal(status.activeProfileId, b.id);
    assert.equal(status.tunnelId, 'tunnel_b');
    assert.equal(status.isConnected, true);

    await assert.rejects(() => service.deleteProfile(b.id), /running OpenAI tunnel profile/i);
    const beforeSignals = [...children[1].signals];
    await assert.rejects(() => service.startTunnel({ profileId: 'missing' }), /Unknown OpenAI tunnel profile/i);
    assert.deepEqual(children[1].signals, beforeSignals, 'unknown profile must not stop the running daemon');

    const incomplete = await service.addProfile({ name: 'Incomplete', tunnelId: 'tunnel_incomplete', runtimeKey: '' });
    await assert.rejects(
      () => service.startTunnel({ profileId: incomplete.id }),
      /Missing OpenAI tunnel ID or runtime key/i
    );
    assert.deepEqual(children[1].signals, beforeSignals, 'incomplete profile must not stop the running daemon');
    assert.equal(service.getStatus().runningProfileId, b.id);

    const stopping = service.stopTunnel();
    children[1].exit(0);
    await stopping;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('forces a hung daemon to terminate before switching profiles', async () => {
  const root = await makeTempRoot('openai-force-switch-');
  try {
    const first = new FakeChildProcess();
    const second = new FakeChildProcess();
    first.onForceKill = () => setImmediate(() => first.exit(0));
    const children = [first, second];
    let spawnIndex = 0;
    const service = new OpenAiTunnelService(root, {
      ensureBinary: async () => '/fake/tunnel-client',
      initializeProfile: () => undefined,
      spawnProcess: (() => children[spawnIndex++] as unknown as ChildProcess) as typeof import('node:child_process').spawn,
      probeReadiness: async () => ({ ready: true, controlPlanePoll: true }),
      stopTimeoutMs: 5,
      forceKillTimeoutMs: 100,
    });
    const a = await service.addProfile({ name: 'A', tunnelId: 'tunnel_a', runtimeKey: 'secret_a' });
    const b = await service.addProfile({ name: 'B', tunnelId: 'tunnel_b', runtimeKey: 'secret_b' });
    await service.startTunnel({ profileId: a.id });

    const switched = await service.startTunnel({ profileId: b.id });
    assert.deepEqual(first.signals, ['SIGTERM', 'SIGKILL']);
    assert.equal(switched.runningProfileId, b.id);

    const stopping = service.stopTunnel();
    second.exit(0);
    await stopping;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
