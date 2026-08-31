import crypto from 'node:crypto';
import type { TunnelSession, TunnelSessionState } from './tunnelSession.js';
import { TunnelSessionStore } from './sessionStore.js';
import { TunnelError } from '../protocol/errors.js';

export interface CreateSessionOptions {
  clientId: string;
  workspaceId: string;
  capabilities: string[];
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export class TunnelSessionLifecycle {
  constructor(private readonly store: TunnelSessionStore) {}

  public createSession(options: CreateSessionOptions): TunnelSession {
    const now = Date.now();
    const ttlMs = options.ttlMs || 3600 * 1000; // Default 1 hour
    const sessionId = `sess_${crypto.randomBytes(8).toString('hex')}`;
    const capabilityToken = `cap_${crypto.randomBytes(16).toString('hex')}`;

    const session: TunnelSession = {
      sessionId,
      clientId: options.clientId,
      workspaceId: options.workspaceId,
      capabilityToken,
      capabilities: [...options.capabilities],
      state: 'ACTIVE',
      createdAt: now,
      expiresAt: now + ttlMs,
      lastHeartbeat: now,
      metadata: options.metadata,
    };

    this.store.set(session);
    return session;
  }

  public heartbeat(sessionId: string): TunnelSession {
    const session = this.store.get(sessionId);
    if (!session) {
      throw new TunnelError('SESSION_NOT_FOUND', 'auth', `Session '${sessionId}' was not found.`);
    }

    if (session.state !== 'ACTIVE' || session.expiresAt <= Date.now()) {
      session.state = 'EXPIRED';
      throw new TunnelError('SESSION_EXPIRED', 'auth', `Session '${sessionId}' has expired.`);
    }

    session.lastHeartbeat = Date.now();
    return session;
  }

  public renew(sessionId: string, extensionMs = 3600 * 1000): TunnelSession {
    const session = this.store.get(sessionId);
    if (!session) {
      throw new TunnelError('SESSION_NOT_FOUND', 'auth', `Session '${sessionId}' was not found.`);
    }

    if (session.state === 'REVOKED') {
      throw new TunnelError('SESSION_REVOKED', 'auth', `Session '${sessionId}' is revoked.`);
    }

    const now = Date.now();
    session.expiresAt = Math.max(session.expiresAt, now) + extensionMs;
    session.state = 'ACTIVE';
    session.lastHeartbeat = now;
    return session;
  }

  public revoke(sessionId: string, reason = 'User requested revocation'): TunnelSession {
    const session = this.store.get(sessionId);
    if (!session) {
      throw new TunnelError('SESSION_NOT_FOUND', 'auth', `Session '${sessionId}' was not found.`);
    }

    session.state = 'REVOKED';
    if (!session.metadata) session.metadata = {};
    session.metadata.revokedAt = Date.now();
    session.metadata.revokeReason = reason;
    return session;
  }

  public transition(sessionId: string, newState: TunnelSessionState): TunnelSession {
    const session = this.store.get(sessionId);
    if (!session) {
      throw new TunnelError('SESSION_NOT_FOUND', 'auth', `Session '${sessionId}' was not found.`);
    }

    session.state = newState;
    return session;
  }
}
