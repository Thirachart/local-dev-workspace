import crypto from 'node:crypto';
import type { HelloFrame, ChallengeFrame, AuthenticateFrame, AcceptedFrame } from '../protocol/protocol.js';
import { TUNNEL_PROTOCOL_VERSION } from '../protocol/protocol.js';
import { TunnelError } from '../protocol/errors.js';
import { ReplayGuard } from './replayGuard.js';
import { TunnelSessionLifecycle } from '../session/sessionLifecycle.js';

export interface PendingChallenge {
  challengeId: string;
  clientId: string;
  nonce: string;
  salt: string;
  timestamp: number;
  requestedCapabilities?: string[];
  workspaceHint?: string;
}

export class TunnelHandshakeEngine {
  private pendingChallenges = new Map<string, PendingChallenge>();
  private readonly bootstrapSecret: string;
  private readonly replayGuard: ReplayGuard;
  private readonly sessionLifecycle: TunnelSessionLifecycle;
  private readonly challengeTtlMs = 60 * 1000; // 1 minute challenge expiry

  constructor(
    bootstrapSecret: string,
    replayGuard: ReplayGuard,
    sessionLifecycle: TunnelSessionLifecycle
  ) {
    this.bootstrapSecret = bootstrapSecret;
    this.replayGuard = replayGuard;
    this.sessionLifecycle = sessionLifecycle;
  }

  public handleHello(hello: HelloFrame): ChallengeFrame {
    // 1. Verify and record nonce against replay
    this.replayGuard.verifyAndRecord(hello.nonce, hello.timestamp);

    // 2. Generate cryptographically secure challenge
    const challengeId = `ch_${crypto.randomBytes(8).toString('hex')}`;
    const salt = crypto.randomBytes(16).toString('hex');

    const pending: PendingChallenge = {
      challengeId,
      clientId: hello.client,
      nonce: hello.nonce,
      salt,
      timestamp: Date.now(),
      requestedCapabilities: hello.requestedCapabilities,
      workspaceHint: hello.workspaceHint,
    };

    this.pendingChallenges.set(challengeId, pending);

    return {
      type: 'challenge',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: `frame_${crypto.randomBytes(6).toString('hex')}`,
      timestamp: Date.now(),
      challengeId,
      salt,
    };
  }

  public handleAuthenticate(auth: AuthenticateFrame, targetWorkspaceId: string): AcceptedFrame {
    const pending = this.pendingChallenges.get(auth.challengeId);
    if (!pending) {
      throw new TunnelError('CHALLENGE_NOT_FOUND', 'auth', 'Handshake challenge not found or expired.');
    }

    this.pendingChallenges.delete(auth.challengeId);

    if (Date.now() - pending.timestamp > this.challengeTtlMs) {
      throw new TunnelError('CHALLENGE_EXPIRED', 'auth', 'Handshake challenge has expired.');
    }

    // Expected credential calculation:
    // HMAC-SHA256(challengeId + ":" + nonce + ":" + salt, bootstrapSecret)
    // or direct bearer secret matching
    const expectedHmac = crypto
      .createHmac('sha256', this.bootstrapSecret)
      .update(`${pending.challengeId}:${pending.nonce}:${pending.salt}`)
      .digest('hex');

    const isHmacMatch = auth.credential === expectedHmac;
    const isDirectSecretMatch = auth.credential === this.bootstrapSecret;

    if (!isHmacMatch && !isDirectSecretMatch) {
      throw new TunnelError('AUTHENTICATION_FAILED', 'auth', 'Invalid authentication credentials.');
    }

    // Determine granted capabilities
    const defaultCapabilities = ['file.read', 'file.write', 'terminal.execute', 'workspace.read', 'git.*'];
    const capabilities = pending.requestedCapabilities && pending.requestedCapabilities.length > 0
      ? pending.requestedCapabilities
      : defaultCapabilities;

    // Resolve and enforce explicit workspace binding
    const boundWorkspaceId = auth.workspaceId || pending.workspaceHint || targetWorkspaceId;
    if (!boundWorkspaceId || typeof boundWorkspaceId !== 'string' || !boundWorkspaceId.trim()) {
      throw new TunnelError('WORKSPACE_REQUIRED', 'validation', 'Workspace binding is required during handshake. Provide workspaceId or workspaceHint.');
    }

    // Create session
    const session = this.sessionLifecycle.createSession({
      clientId: pending.clientId,
      workspaceId: boundWorkspaceId.trim(),
      capabilities,
      ttlMs: 3600 * 1000,
      metadata: {
        nonce: pending.nonce,
        authenticatedAt: Date.now(),
      },
    });

    return {
      type: 'accepted',
      protocolVersion: TUNNEL_PROTOCOL_VERSION,
      id: `frame_${crypto.randomBytes(6).toString('hex')}`,
      timestamp: Date.now(),
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      capabilityToken: session.capabilityToken,
      expiresAt: session.expiresAt,
      capabilities: session.capabilities,
    };
  }
}
