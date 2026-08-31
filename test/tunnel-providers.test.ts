import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SelfHostedProvider } from '../src/tunnel/providers/selfHostedProvider.js';
import { OpenAIProvider } from '../src/tunnel/providers/openaiProvider.js';
import { TUNNEL_PROTOCOL_VERSION } from '../src/tunnel/protocol/protocol.js';

describe('Phase 4 & 5: Tunnel Providers & Server Runtime', () => {
  const testPort = 4199;
  const bootstrapSecret = 'test_bootstrap_secret_123';
  const provider = new SelfHostedProvider({
    port: testPort,
    bootstrapSecret,
    defaultWorkspaceId: 'ws_test_4100',
  });

  before(async () => {
    await provider.connect();
  });

  after(async () => {
    await provider.disconnect();
  });

  it('reports online status and port endpoint', () => {
    const status = provider.getStatus();
    assert.strictEqual(status.provider, 'self-hosted');
    assert.strictEqual(status.mode, 'inbound');
    assert.strictEqual(status.isConnected, true);
    assert.ok(status.endpointUrl?.includes(':4199'));
  });

  it('executes full handshake, sends tool request, and receives response', async () => {
    // 1. Send Hello
    const nonce = `nonce_${crypto.randomBytes(8).toString('hex')}`;
    const helloRes = await provider.send({
      type: 'hello',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_h1',
      timestamp: Date.now(),
      client: 'unit-tester',
      nonce,
      requestedCapabilities: ['file.read', 'file.write'],
    });

    assert.strictEqual(helloRes.type, 'challenge');
    const { challengeId, salt } = helloRes;

    // 2. Send Authenticate
    const signature = crypto
      .createHmac('sha256', bootstrapSecret)
      .update(`${challengeId}:${nonce}:${salt}`)
      .digest('hex');

    const authRes = await provider.send({
      type: 'authenticate',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_a1',
      timestamp: Date.now(),
      challengeId,
      credential: signature,
    });

    assert.strictEqual(authRes.type, 'accepted');
    const { sessionId, capabilityToken } = authRes;
    assert.ok(sessionId);
    assert.ok(capabilityToken);

    // 3. Send Tool Request Frame
    const reqRes = await provider.send({
      type: 'request',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_r1',
      timestamp: Date.now(),
      sessionId,
      capabilityToken,
      tool: 'read_file',
      parameters: { path: 'package.json' },
    });

    assert.strictEqual(reqRes.type, 'response');
    assert.strictEqual(reqRes.success, true);
    assert.strictEqual(reqRes.requestId, 'f_r1');

    // 4. Heartbeat
    const hbRes = await provider.send({
      type: 'heartbeat',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_hb1',
      timestamp: Date.now(),
      sessionId,
      sequence: 1,
    });
    assert.strictEqual(hbRes.success, true);

    // 5. Disconnect
    const discRes = await provider.send({
      type: 'disconnect',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_d1',
      timestamp: Date.now(),
      sessionId,
      reason: 'Test complete',
    });
    assert.strictEqual(discRes.success, true);
  });

  it('OpenAIProvider initializes and returns status and mock send frame', async () => {
    const openai = new OpenAIProvider({
      tunnelId: 'tun_mock_12345',
      runtimeKey: 'sk-mock-key',
    });

    await openai.connect();
    const status = openai.getStatus();
    assert.strictEqual(status.provider, 'openai-platform');
    assert.strictEqual(status.mode, 'outbound');
    assert.strictEqual(status.tunnelId, 'tun_mock_12345');

    const res = await openai.send({
      type: 'heartbeat',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_o1',
      timestamp: Date.now(),
      sessionId: 'sess_openai_1',
      sequence: 1,
    });
    assert.strictEqual((res as any).success, true);

    await openai.disconnect();
    assert.strictEqual(openai.getStatus().isConnected, false);
  });
});
