import crypto from 'node:crypto';

export interface WorkspaceIdentity {
  workspaceId: string;
  root: string;
  createdAt: string;
}

export function createWorkspaceIdentity(root: string): WorkspaceIdentity {
  const normalized = root.replace(/\\/g, '/').toLowerCase();
  return {
    workspaceId: `ws_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`,
    root,
    createdAt: new Date().toISOString(),
  };
}
