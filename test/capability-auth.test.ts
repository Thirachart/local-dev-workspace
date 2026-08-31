import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ReplayGuard } from '../src/tunnel/auth/replayGuard.js';
import { CapabilityResolver } from '../src/tunnel/auth/capabilityResolver.js';
import { TunnelSessionStore } from '../src/tunnel/session/sessionStore.js';
import { TunnelSessionLifecycle } from '../src/tunnel/session/sessionLifecycle.js';
import { TunnelHandshakeEngine } from '../src/tunnel/auth/handshake.js';
import { TUNNEL_PROTOCOL_VERSION } from '../src/tunnel/protocol/protocol.js';
import { TunnelError } from '../src/tunnel/protocol/errors.js';

describe('Phase 3: Authentication, Capability & Replay Guard', () => {
  it('ReplayGuard detects and rejects duplicate nonces', () => {
    const guard = new ReplayGuard(5000);
    const nonce = 'unique-nonce-12345';

    guard.verifyAndRecord(nonce);
    assert.strictEqual(guard.has(nonce), true);

    assert.throws(
      () => guard.verifyAndRecord(nonce),
      (err: any) => err instanceof TunnelError && err.code === 'REPLAY_ATTACK_DETECTED'
    );
  });

  it('CapabilityResolver maps tool names and enforces permissions', () => {
    const resolver = new CapabilityResolver();

    assert.strictEqual(resolver.resolveRequiredCapability('read_file'), 'file.read');
    assert.strictEqual(resolver.resolveRequiredCapability('context_delivery_status'), 'file.read');
    assert.strictEqual(resolver.resolveRequiredCapability('edit_file'), 'file.write');
    assert.strictEqual(resolver.resolveRequiredCapability('run_command'), 'terminal.execute');
    assert.strictEqual(resolver.resolveRequiredCapability('git_commit'), 'git.commit');

    // Granted exact match
    resolver.assertCapability(['file.read', 'file.write'], 'file.read', 'read_file');

    // Granted wildcard match
    resolver.assertCapability(['file.*'], 'file.write', 'edit_file');
    resolver.assertCapability(['*'], 'terminal.execute', 'run_command');

    // Denied capability
    assert.throws(
      () => resolver.assertCapability(['file.read'], 'file.write', 'edit_file'),
      (err: any) => err instanceof TunnelError && err.code === 'CAPABILITY_DENIED'
    );
  });

  it('TunnelHandshakeEngine performs full 4-step handshake and issues session', () => {
    const bootstrapSecret = 'test-secret-1234567890';
    const store = new TunnelSessionStore();
    const lifecycle = new TunnelSessionLifecycle(store);
    const replayGuard = new ReplayGuard();
    const engine = new TunnelHandshakeEngine(bootstrapSecret, replayGuard, lifecycle);

    // 1. Client Hello
    const nonce = `nonce_${crypto.randomBytes(8).toString('hex')}`;
    const helloFrame = {
      type: 'hello' as const,
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_hello_1',
      timestamp: Date.now(),
      client: 'remote-agent-test',
      nonce,
      requestedCapabilities: ['file.read', 'file.write'],
      workspaceHint: 'ws_demo_99',
    };

    const challenge = engine.handleHello(helloFrame);
    assert.strictEqual(challenge.type, 'challenge');
    assert.ok(challenge.challengeId.startsWith('ch_'));
    assert.ok(challenge.salt.length > 0);

    // 2. Client Authenticate with HMAC signature
    const signature = crypto
      .createHmac('sha256', bootstrapSecret)
      .update(`${challenge.challengeId}:${nonce}:${challenge.salt}`)
      .digest('hex');

    const authFrame = {
      type: 'authenticate' as const,
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_auth_1',
      timestamp: Date.now(),
      challengeId: challenge.challengeId,
      credential: signature,
      workspaceId: 'ws_demo_99',
    };

    const accepted = engine.handleAuthenticate(authFrame, 'ws_fallback');
    assert.strictEqual(accepted.type, 'accepted');
    assert.ok(accepted.sessionId.startsWith('sess_'));
    assert.ok(accepted.capabilityToken.startsWith('cap_'));
    assert.strictEqual(accepted.workspaceId, 'ws_demo_99');
    assert.deepStrictEqual(accepted.capabilities, ['file.read', 'file.write']);
    assert.ok(accepted.expiresAt > Date.now());

    // Verify session was created in store
    const session = store.get(accepted.sessionId);
    assert.ok(session);
    assert.strictEqual(session?.state, 'ACTIVE');
  });

  it('rejects handshake with invalid credentials', () => {
    const bootstrapSecret = 'test-secret-1234567890';
    const store = new TunnelSessionStore();
    const lifecycle = new TunnelSessionLifecycle(store);
    const replayGuard = new ReplayGuard();
    const engine = new TunnelHandshakeEngine(bootstrapSecret, replayGuard, lifecycle);

    const nonce = `nonce_${crypto.randomBytes(8).toString('hex')}`;
    const challenge = engine.handleHello({
      type: 'hello',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_hello_2',
      timestamp: Date.now(),
      client: 'remote-agent-test',
      nonce,
    });

    assert.throws(
      () =>
        engine.handleAuthenticate(
          {
            type: 'authenticate',
            protocolVersion: TUNNEL_PROTOCOL_VERSION,
            id: 'f_auth_2',
            timestamp: Date.now(),
            challengeId: challenge.challengeId,
            credential: 'wrong_secret_signature',
          },
          'ws_test'
        ),
      (err: any) => err instanceof TunnelError && err.code === 'AUTHENTICATION_FAILED'
    );
  });
});
