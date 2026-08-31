import type { AgentSession } from './sessionManager.js';
import type { CapabilityToken } from './capabilityToken.js';

export interface SessionContext {
  session?: AgentSession;
  token?: CapabilityToken;
  workspaceId?: string;
  snapshotId?: string;
}

export function hasCapability(context: SessionContext, capability: string): boolean {
  return Boolean(
    context.token &&
    context.token.expiresAt > Date.now() &&
    context.token.capabilities.includes(capability)
  );
}
