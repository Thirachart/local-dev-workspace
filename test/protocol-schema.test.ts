import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTunnelFrame, serializeTunnelFrame, createErrorFrame, createResponseFrame } from '../src/tunnel/protocol/validation.js';
import { TUNNEL_PROTOCOL_VERSION } from '../src/tunnel/protocol/protocol.js';
import { TunnelError } from '../src/tunnel/protocol/errors.js';

describe('Phase 1: Tunnel Protocol & Schema Validation', () => {
  it('parses valid hello frame successfully', () => {
    const raw = {
      type: 'hello',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_123',
      timestamp: Date.now(),
      client: 'remote-agent-v1',
      nonce: 'random-nonce-12345',
      requestedCapabilities: ['file.read', 'file.write'],
    };

    const parsed = parseTunnelFrame(raw);
    assert.strictEqual(parsed.type, 'hello');
    assert.strictEqual(parsed.client, 'remote-agent-v1');
  });

  it('rejects invalid protocol version', () => {
    const raw = {
      type: 'hello',
      protocolVersion: '1.0', // Wrong version
      id: 'f_123',
      timestamp: Date.now(),
      client: 'remote-agent-v1',
      nonce: 'random-nonce-12345',
    };

    assert.throws(
      () => parseTunnelFrame(raw),
      (err: any) => err instanceof TunnelError && err.code === 'FRAME_VALIDATION_ERROR'
    );
  });

  it('rejects frame missing required fields', () => {
    const raw = {
      type: 'request',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'f_123',
      timestamp: Date.now(),
      // missing sessionId, capabilityToken, tool
    };

    assert.throws(
      () => parseTunnelFrame(raw),
      (err: any) => err instanceof TunnelError && err.code === 'FRAME_VALIDATION_ERROR'
    );
  });

  it('parses JSON string into typed frame and serializes back', () => {
    const frameObj = {
      type: 'heartbeat',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: 'hb_1',
      timestamp: 1787000000000,
      sessionId: 'sess_test1',
      sequence: 42,
    };

    const jsonStr = serializeTunnelFrame(frameObj as any);
    const parsed = parseTunnelFrame(jsonStr);
    assert.strictEqual(parsed.type, 'heartbeat');
    assert.strictEqual((parsed as any).sequence, 42);
  });

  it('creates standardized error and response frames', () => {
    const errFrame = createErrorFrame('AUTH_FAILED', 'auth', 'Invalid credentials', 'req_99');
    assert.strictEqual(errFrame.type, 'error');
    assert.strictEqual(errFrame.code, 'AUTH_FAILED');
    assert.strictEqual(errFrame.requestId, 'req_99');

    const respFrame = createResponseFrame('req_99', true, { output: 'hello' }, 'snap_123', 15);
    assert.strictEqual(respFrame.type, 'response');
    assert.strictEqual(respFrame.success, true);
    assert.strictEqual(respFrame.snapshotId, 'snap_123');
    assert.strictEqual(respFrame.executionTimeMs, 15);
  });
});
