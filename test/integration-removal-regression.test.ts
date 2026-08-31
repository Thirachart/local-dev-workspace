import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import * as authModule from '../src/services/authService.js';
import { AuthService } from '../src/services/authService.js';
import { ProjectService } from '../src/services/projectService.js';
import { getOpenApiSpec, getProfileOpCounts } from '../src/transports/openapi.js';
import { renderDashboardHtml } from '../src/ui/dashboard.js';
import { listPublicToolMetadata } from '../src/tools/registry.js';

describe('Removed integration regressions', () => {
  let testDir: string;

  before(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dev-removed-integrations-'));
    await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
    await fs.writeFile(
      path.join(testDir, 'config', 'auth.json'),
      JSON.stringify({
        apiKey: 'test-key',
        preferredTunnel: 'cloudflare',
        autoStartTunnel: true,
        cloudflareToken: 'obsolete-cloudflare-token',
        linearApiKey: 'obsolete-linear-key',
        openapiProfile: 'linear',
      })
    );
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('selects the startup tunnel only from the persisted setting', () => {
    const resolveStartupTunnel = (authModule as any).resolveStartupTunnel;
    assert.strictEqual(typeof resolveStartupTunnel, 'function');
    assert.strictEqual(resolveStartupTunnel({ preferredTunnel: 'openai', autoStart: true }), 'openai');
    assert.strictEqual(resolveStartupTunnel({ preferredTunnel: 'ngrok', autoStart: true }), 'ngrok');
    assert.strictEqual(resolveStartupTunnel({ preferredTunnel: 'openai', autoStart: false }), 'none');
  });

  it('migrates removed Cloudflare and Linear settings safely', async () => {
    const auth = new AuthService(testDir);

    assert.deepStrictEqual(auth.getTunnelPreference(), { preferredTunnel: 'none', autoStart: false });
    assert.strictEqual(auth.getProfilePreference().profile, 'core');

    const persisted = JSON.parse(await fs.readFile(path.join(testDir, 'config', 'auth.json'), 'utf8'));
    assert.strictEqual(persisted.preferredTunnel, 'none');
    assert.strictEqual(persisted.autoStartTunnel, false);
    assert.strictEqual('cloudflareToken' in persisted, false);
    assert.strictEqual('linearApiKey' in persisted, false);
  });

  it('removes obsolete Linear context from the project registry', async () => {
    const projectsFile = path.join(testDir, 'config', 'projects.json');
    await fs.writeFile(projectsFile, JSON.stringify([{
      id: 'proj_legacy',
      name: 'legacy',
      path: testDir,
      permissions: { canRead: true, canWrite: true, canRunCommand: true },
      linearConfig: { teamKey: 'OLD', projectName: 'Removed integration' },
      createdAt: '2026-01-01T00:00:00.000Z',
    }]));

    new ProjectService(testDir);

    const persisted = JSON.parse(await fs.readFile(projectsFile, 'utf8'));
    assert.strictEqual('linearConfig' in persisted[0], false);
  });

  it('does not publish removed integrations through MCP, OpenAPI, or the dashboard', () => {
    const toolNames = listPublicToolMetadata().map((tool) => tool.name);
    assert.strictEqual(toolNames.some((name) => name.startsWith('linear_')), false);
    assert.strictEqual(toolNames.includes('codex_run'), false);

    const fullSpec = getOpenApiSpec('http://localhost:4100', 'full');
    assert.strictEqual(Object.keys(fullSpec.paths).some((route) => route.includes('linear_')), false);
    assert.strictEqual('/api/codex_run' in fullSpec.paths, false);
    assert.strictEqual('linear' in getProfileOpCounts(), false);

    const dashboard = renderDashboardHtml();
    assert.doesNotMatch(dashboard, /Cloudflare Tunnel/i);
    assert.doesNotMatch(dashboard, /Linear Integration/i);
    assert.doesNotMatch(dashboard, /codex_run/i);
  });

  it('does not advertise removed tunnel flags in CLI help', () => {
    const help = execFileSync(
      process.execPath,
      ['--import', 'tsx', 'src/index.ts', '--help'],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    assert.doesNotMatch(help, /--cloudflare/);
    assert.doesNotMatch(help, /--openai-tunnel/);
    assert.doesNotMatch(help, /--tunnel-client/);
  });

  it('does not ship removed integration dependencies', async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.strictEqual(packageJson.dependencies?.['@linear/sdk'], undefined);
    assert.strictEqual(packageJson.dependencies?.cloudflared, undefined);
  });
});
