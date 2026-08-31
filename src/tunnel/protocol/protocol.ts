export const TUNNEL_PROTOCOL_VERSION = '2.0';

export type TunnelFrameType =
  | 'hello'
  | 'challenge'
  | 'authenticate'
  | 'accepted'
  | 'request'
  | 'response'
  | 'heartbeat'
  | 'disconnect'
  | 'error';

export interface BaseTunnelFrame {
  type: TunnelFrameType;
  protocolVersion: string;
  id: string;
  timestamp: number;
}

export interface HelloFrame extends BaseTunnelFrame {
  type: 'hello';
  client: string;
  nonce: string;
  requestedCapabilities?: string[];
  workspaceHint?: string;
}

export interface ChallengeFrame extends BaseTunnelFrame {
  type: 'challenge';
  challengeId: string;
  salt: string;
}

export interface AuthenticateFrame extends BaseTunnelFrame {
  type: 'authenticate';
  challengeId: string;
  credential: string;
  workspaceId?: string;
}

export interface AcceptedFrame extends BaseTunnelFrame {
  type: 'accepted';
  sessionId: string;
  workspaceId: string;
  capabilityToken: string;
  expiresAt: number;
  capabilities: string[];
}

export interface RequestFrame extends BaseTunnelFrame {
  type: 'request';
  sessionId: string;
  capabilityToken: string;
  tool: string;
  parameters: Record<string, unknown>;
  expectedSnapshotId?: string;
}

export interface ResponseFrame extends BaseTunnelFrame {
  type: 'response';
  requestId: string;
  success: boolean;
  result?: unknown;
  snapshotId?: string;
  executionTimeMs?: number;
}

export interface HeartbeatFrame extends BaseTunnelFrame {
  type: 'heartbeat';
  sessionId: string;
  sequence: number;
}

export interface DisconnectFrame extends BaseTunnelFrame {
  type: 'disconnect';
  sessionId?: string;
  reason?: string;
}

export interface ErrorFrame extends BaseTunnelFrame {
  type: 'error';
  requestId?: string;
  code: string;
  category: string;
  message: string;
  details?: Record<string, unknown>;
}

export type AnyTunnelFrame =
  | HelloFrame
  | ChallengeFrame
  | AuthenticateFrame
  | AcceptedFrame
  | RequestFrame
  | ResponseFrame
  | HeartbeatFrame
  | DisconnectFrame
  | ErrorFrame;
