import crypto from 'node:crypto';

export interface CapabilityToken {
  token: string;
  sessionId: string;
  capabilities: string[];
  expiresAt: number;
}

export function issueCapabilityToken(sessionId: string, capabilities: string[], ttlMs = 3600000): CapabilityToken {
  return {
    token: `cap_${crypto.randomBytes(16).toString('hex')}`,
    sessionId,
    capabilities: [...capabilities],
    expiresAt: Date.now() + ttlMs,
  };
}

export function validateCapabilityToken(token: CapabilityToken, capability: string): boolean {
  return token.expiresAt > Date.now() && token.capabilities.includes(capability);
}
