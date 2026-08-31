import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

import { FileService } from '../src/services/fileService.js';
import { PatchService } from '../src/services/patchService.js';
import { ProcessService } from '../src/services/processService.js';
import { TunnelBootstrapService } from '../src/tunnel/auth/bootstrapService.js';
import { TunnelServerRuntime } from '../src/tunnel/server/tunnelServer.js';
import type { ToolExecutor } from '../src/tunnel/server/tunnelRouter.js';
import { TUNNEL_PROTOCOL_VERSION } from '../src/tunnel/protocol/protocol.js';

describe('Phase 8: Real MCP Core ToolRegistry Integration through Secure Tunnel', () => {
  let tempDir: string;
  let fileService: FileService;
  let patchService: PatchService;
  let processService: ProcessService;
  let runtime: TunnelServerRuntime;
  let bootstrapService: TunnelBootstrapService;
  const projectName = 'tunnel-real-tools-test';
  const testPort = 4192;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunnel-real-tools-'));
    fileService = new FileService(tempDir);
    patchService = new PatchService(tempDir);
    processService = new ProcessService(tempDir);
    bootstrapService = new TunnelBootstrapService(tempDir);

    const realToolExecutor: ToolExecutor = {
      executeTool: async (tool, params, _context) => {
        if (tool === 'write_file') {
          const res = await fileService.writeFile(params.path as string, params.content as string, { project: projectName });
          return { result: res };
        }
        if (tool === 'read_file') {
          const res = await fileService.readFile(params.path as string, { project: projectName });
          return { result: res };
        }
        if (tool === 'apply_patch') {
          const chunks = params.chunks as any || [
            {
              filePath: params.path as string,
              targetContent: params.targetContent as string,
              replacementContent: params.replacementContent as string,
              expectedBeforeHash: params.expectedBaseHash as string,
            },
          ];
          const res = await patchService.applyStructuredPatch(chunks);
          return { result: res };
        }
        if (tool === 'run_command') {
          const res = await processService.runCommand({ command: params.command as string, project: projectName });
          return { result: res };
        }
        throw new Error(`Tool ${tool} not found`);
      },
    };

    runtime = new TunnelServerRuntime({
      port: testPort,
      bootstrapService,
      toolExecutor: realToolExecutor,
      defaultWorkspaceId: 'ws_isolated_real',
    });

    await runtime.start();
  });

  after(async () => {
    await runtime.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('executes real write_file, read_file, apply_patch, and run_command through Secure Tunnel', async () => {
    // 1. Handshake
    const nonce = `nonce_${crypto.randomBytes(8).toString('hex')}`;
    const helloRes = await fetch(`http://127.0.0.1:${testPort}/tunnel/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'hello',
        protocolVersion: TUNNEL_PROTOCOL_VERSION,
        id: 'f_h_real',
        timestamp: Date.now(),
        client: 'real-tool-tester',
        nonce,
        requestedCapabilities: ['file.read', 'file.write', 'terminal.execute'],
        workspaceHint: 'ws_isolated_real',
      }),
    });
    const challenge = await helloRes.json();
    assert.strictEqual(challenge.type, 'challenge');

    const signature = crypto
      .createHmac('sha256', bootstrapService.getSecret())
      .update(`${challenge.challengeId}:${nonce}:${challenge.salt}`)
      .digest('hex');

    const authRes = await fetch(`http://127.0.0.1:${testPort}/tunnel/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'authenticate',
        protocolVersion: TUNNEL_PROTOCOL_VERSION,
        id: 'f_a_real',
        timestamp: Date.now(),
        challengeId: challenge.challengeId,
        credential: signature,
        workspaceId: 'ws_isolated_real',
      }),
    });
    const accepted = await authRes.json();
    assert.strictEqual(accepted.type, 'accepted');
    const { sessionId, capabilityToken } = accepted;

    // 2. Real write_file through Tunnel
    const writeRes = await fetch(`http://127.0.0.1:${testPort}/tunnel/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'request',
        protocolVersion: TUNNEL_PROTOCOL_VERSION,
        id: 'f_req_write',
        timestamp: Date.now(),
        sessionId,
        capabilityToken,
        tool: 'write_file',
        parameters: { path: 'app.config.ts', content: 'export const port = 4100;\nexport const mode = "production";\n' },
      }),
    });
    const writeData = await writeRes.json();
    assert.strictEqual(writeData.type, 'response');
    assert.strictEqual(writeData.success, true);

    // Verify written file on local disk
    const onDiskContent = await fs.readFile(path.join(tempDir, 'app.config.ts'), 'utf-8');
    assert.strictEqual(onDiskContent, 'export const port = 4100;\nexport const mode = "production";\n');

    // 3. Real read_file through Tunnel
    const readRes = await fetch(`http://127.0.0.1:${testPort}/tunnel/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'request',
        protocolVersion: TUNNEL_PROTOCOL_VERSION,
        id: 'f_req_read',
        timestamp: Date.now(),
        sessionId,
        capabilityToken,
        tool: 'read_file',
        parameters: { path: 'app.config.ts' },
      }),
    });
    const readData = await readRes.json();
    assert.strictEqual(readData.type, 'response');
    assert.strictEqual(readData.success, true);
    assert.strictEqual(readData.result.content, onDiskContent);

    // 4. Real apply_patch through Tunnel with SHA-256 CAS hash guard
    const baseHash = crypto.createHash('sha256').update(onDiskContent).digest('hex');
    const patchRes = await fetch(`http://127.0.0.1:${testPort}/tunnel/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'request',
        protocolVersion: TUNNEL_PROTOCOL_VERSION,
        id: 'f_req_patch',
        timestamp: Date.now(),
        sessionId,
        capabilityToken,
        tool: 'apply_patch',
        parameters: {
          chunks: [
            {
              filePath: 'app.config.ts',
              targetContent: 'export const port = 4100;',
              replacementContent: 'export const port = 8080;',
              expectedBeforeHash: baseHash,
            },
          ],
        },
      }),
    });
    const patchData = await patchRes.json();
    assert.strictEqual(patchData.type, 'response');
    assert.strictEqual(patchData.success, true);

    const patchedContent = await fs.readFile(path.join(tempDir, 'app.config.ts'), 'utf-8');
    assert.strictEqual(patchedContent, 'export const port = 8080;\nexport const mode = "production";\n');

    // 5. Real run_command (terminal.execute) through Tunnel
    const cmdRes = await fetch(`http://127.0.0.1:${testPort}/tunnel/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'request',
        protocolVersion: TUNNEL_PROTOCOL_VERSION,
        id: 'f_req_cmd',
        timestamp: Date.now(),
        sessionId,
        capabilityToken,
        tool: 'run_command',
        parameters: { command: 'echo "TUNNEL_EXEC_OK"' },
      }),
    });
    const cmdData = await cmdRes.json();
    assert.strictEqual(cmdData.type, 'response');
    assert.strictEqual(cmdData.success, true);
    assert.ok((cmdData.result.stdout || cmdData.result.output || '').includes('TUNNEL_EXEC_OK'));
  });

  it('rejects mutation when session lacks required capability', async () => {
    // Create read-only session
    const readOnlySession = runtime.sessionLifecycle.createSession({
      clientId: 'readonly-client',
      workspaceId: 'ws_isolated_real',
      capabilities: ['file.read'], // No file.write or terminal.execute
    });

    const writeAttempt = await fetch(`http://127.0.0.1:${testPort}/tunnel/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'request',
        protocolVersion: TUNNEL_PROTOCOL_VERSION,
        id: 'f_req_unauth',
        timestamp: Date.now(),
        sessionId: readOnlySession.sessionId,
        capabilityToken: readOnlySession.capabilityToken,
        tool: 'write_file',
        parameters: { path: 'hacked.txt', content: 'malicious' },
      }),
    });

    const writeData = await writeAttempt.json();
    assert.strictEqual(writeData.type, 'error');
    assert.strictEqual(writeData.code, 'CAPABILITY_DENIED');
    assert.strictEqual(writeData.category, 'permission');
  });
});
