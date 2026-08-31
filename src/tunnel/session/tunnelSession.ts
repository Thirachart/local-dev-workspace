export type TunnelSessionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'SESSION_CREATED'
  | 'WORKSPACE_BOUND'
  | 'ACTIVE'
  | 'CLOSING'
  | 'EXPIRED'
  | 'REVOKED';

export interface TunnelSession {
  sessionId: string;
  clientId: string;
  workspaceId: string;
  capabilityToken: string;
  capabilities: string[];
  state: TunnelSessionState;
  createdAt: number;
  expiresAt: number;
  lastHeartbeat: number;
  metadata?: Record<string, unknown>;
}

export function isSessionActive(session: TunnelSession): boolean {
  return session.state === 'ACTIVE' && session.expiresAt > Date.now();
}
