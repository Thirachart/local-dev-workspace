import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TunnelSessionStore } from '../src/tunnel/session/sessionStore.js';
import { TunnelSessionLifecycle } from '../src/tunnel/session/sessionLifecycle.js';
import { TunnelError } from '../src/tunnel/protocol/errors.js';

describe('Phase 2: Tunnel Session Engine & Lifecycle', () => {
  it('creates active session with capability token and ttl', () => {
    const store = new TunnelSessionStore();
    const lifecycle = new TunnelSessionLifecycle(store);

    const session = lifecycle.createSession({
      clientId: 'chatgpt-client-1',
      workspaceId: 'ws_demo_123',
      capabilities: ['file.read', 'file.write'],
      ttlMs: 5000,
    });

    assert.ok(session.sessionId.startsWith('sess_'));
    assert.ok(session.capabilityToken.startsWith('cap_'));
    assert.strictEqual(session.state, 'ACTIVE');
    assert.strictEqual(session.workspaceId, 'ws_demo_123');
    assert.strictEqual(store.size, 1);
  });

  it('updates lastHeartbeat on heartbeat call', async () => {
    const store = new TunnelSessionStore();
    const lifecycle = new TunnelSessionLifecycle(store);

    const session = lifecycle.createSession({
      clientId: 'agent-2',
      workspaceId: 'ws_demo_123',
      capabilities: ['file.read'],
      ttlMs: 5000,
    });

    const originalHeartbeat = session.lastHeartbeat;
    await new Promise((r) => setTimeout(r, 10));

    const updated = lifecycle.heartbeat(session.sessionId);
    assert.ok(updated.lastHeartbeat > originalHeartbeat);
  });

  it('detects expiration and rejects expired session heartbeat', () => {
    const store = new TunnelSessionStore();
    const lifecycle = new TunnelSessionLifecycle(store);

    const session = lifecycle.createSession({
      clientId: 'agent-3',
      workspaceId: 'ws_demo_123',
      capabilities: ['file.read'],
      ttlMs: -100, // Already expired
    });

    assert.throws(
      () => lifecycle.heartbeat(session.sessionId),
      (err: any) => err instanceof TunnelError && err.code === 'SESSION_EXPIRED'
    );
  });

  it('revokes session and prevents renewal if revoked', () => {
    const store = new TunnelSessionStore();
    const lifecycle = new TunnelSessionLifecycle(store);

    const session = lifecycle.createSession({
      clientId: 'agent-4',
      workspaceId: 'ws_demo_123',
      capabilities: ['terminal.execute'],
    });

    lifecycle.revoke(session.sessionId, 'Compromised token');
    const revoked = store.get(session.sessionId);
    assert.strictEqual(revoked?.state, 'REVOKED');

    assert.throws(
      () => lifecycle.renew(session.sessionId),
      (err: any) => err instanceof TunnelError && err.code === 'SESSION_REVOKED'
    );
  });

  it('prunes expired and revoked sessions from store', () => {
    const store = new TunnelSessionStore();
    const lifecycle = new TunnelSessionLifecycle(store);

    const active = lifecycle.createSession({ clientId: 'a1', workspaceId: 'ws1', capabilities: ['read'], ttlMs: 10000 });
    const expired = lifecycle.createSession({ clientId: 'a2', workspaceId: 'ws1', capabilities: ['read'], ttlMs: -100 });
    const revoked = lifecycle.createSession({ clientId: 'a3', workspaceId: 'ws1', capabilities: ['read'], ttlMs: 10000 });
    lifecycle.revoke(revoked.sessionId);

    assert.strictEqual(store.size, 3);
    const prunedCount = store.pruneExpired();
    assert.strictEqual(prunedCount, 2);
    assert.strictEqual(store.size, 1);
    assert.ok(store.get(active.sessionId));
  });
});
