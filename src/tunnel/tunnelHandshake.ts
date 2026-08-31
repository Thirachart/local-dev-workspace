import crypto from 'node:crypto';
import type { WorkspaceIdentity } from '../session/workspaceIdentity.js';

export interface TunnelHandshake {
  tunnelId: string;
  workspaceId: string;
  issuedAt: number;
  nonce: string;
}

export function createTunnelHandshake(workspace: WorkspaceIdentity): TunnelHandshake {
  return {
    tunnelId: `tun_${crypto.randomBytes(8).toString('hex')}`,
    workspaceId: workspace.workspaceId,
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
}
