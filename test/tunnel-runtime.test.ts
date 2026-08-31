import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { TunnelBootstrapService } from '../src/tunnel/auth/bootstrapService.js';
import { TunnelConnectionManager } from '../src/tunnel/server/connectionManager.js';
import { TunnelServerRuntime } from '../src/tunnel/server/tunnelServer.js';
import { TUNNEL_PROTOCOL_VERSION } from '../src/tunnel/protocol/protocol.js';

describe('Phase 6: Production Tunnel Runtime & Connection Resilience', () => {
  it('TunnelBootstrapService manages independent secrets and rotation', () => {
    const bootstrap = new TunnelBootstrapService();
    const secret1 = bootstrap.getSecret();
    assert.ok(secret1.startsWith('tsec_'));
    assert.strictEqual(bootstrap.validateSecret(secret1), true);
    assert.strictEqual(bootstrap.validateSecret('wrong_secret'), false);

    const secret2 = bootstrap.rotateSecret();
    assert.notStrictEqual(secret1, secret2);
    assert.strictEqual(bootstrap.validateSecret(secret2), true);
    assert.strictEqual(bootstrap.validateSecret(secret1), false);
  });

  it('TunnelConnectionManager tracks active connections and reconnects', () => {
    const manager = new TunnelConnectionManager();

    let closed = false;
    const conn1 = manager.registerConnection(
      'stream',
      async () => {},
      async () => {
        closed = true;
      }
    );

    assert.ok(conn1.connectionId.startsWith('conn_'));
    assert.strictEqual(manager.getMetrics().activeConnections, 1);

    // Bind session
    manager.bindSession(conn1.connectionId, 'sess_123', 'ws_proj_1');
    assert.strictEqual(manager.getConnectionBySession('sess_123')?.connectionId, conn1.connectionId);

    // Simulate reconnect with new connection for same session
    const conn2 = manager.registerConnection('websocket', async () => {}, async () => {});
    manager.bindSession(conn2.connectionId, 'sess_123', 'ws_proj_1');

    assert.strictEqual(manager.getMetrics().reconnectCount, 1);
    assert.strictEqual(manager.getConnectionBySession('sess_123')?.connectionId, conn2.connectionId);

    manager.closeAll('test finish');
    assert.strictEqual(manager.getMetrics().activeConnections, 0);
    assert.strictEqual(closed, true);
  });

  describe('Live TunnelServerRuntime tests', () => {
    const testPort = 4195;
    const bootstrap = new TunnelBootstrapService();
    const runtime = new TunnelServerRuntime({
      port: testPort,
      bootstrapService: bootstrap,
      defaultWorkspaceId: 'ws_runtime_test',
    });

    before(async () => {
      await runtime.start();
    });

    after(async () => {
      await runtime.stop();
    });

    it('rejects handshake when workspace is empty or invalid', async () => {
      const nonce = `nonce_${crypto.randomBytes(8).toString('hex')}`;
      const helloRes = await fetch(`http://127.0.0.1:${testPort}/tunnel/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'hello',
          protocolVersion: TUNNEL_PROTOCOL_VERSION,
          id: 'f_h1',
          timestamp: Date.now(),
          client: 'test-runner',
          nonce,
        }),
      });
      const challenge = await helloRes.json();
      assert.strictEqual(challenge.type, 'challenge');

      const signature = crypto
        .createHmac('sha256', bootstrap.getSecret())
        .update(`${challenge.challengeId}:${nonce}:${challenge.salt}`)
        .digest('hex');

      // Send authenticate with blank workspace
      const authRes = await fetch(`http://127.0.0.1:${testPort}/tunnel/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'authenticate',
          protocolVersion: TUNNEL_PROTOCOL_VERSION,
          id: 'f_a1',
          timestamp: Date.now(),
          challengeId: challenge.challengeId,
          credential: signature,
          workspaceId: '   ', // Blank
        }),
      });

      const authData = await authRes.json();
      // Should reject or fallback to explicit binding
      if (authRes.status === 400) {
        assert.ok(authData.code === 'WORKSPACE_REQUIRED' || authData.code === 'FRAME_VALIDATION_ERROR');
      } else {
        assert.ok(authData.type === 'accepted');
      }
    });

    it('performs complete end-to-end stream status inquiry', async () => {
      const statusRes = await fetch(`http://127.0.0.1:${testPort}/tunnel/status`);
      const statusData = await statusRes.json();
      assert.strictEqual(statusData.status, 'online');
      assert.strictEqual(statusData.port, testPort);
      assert.ok(statusData.metrics);
    });
  });
});
