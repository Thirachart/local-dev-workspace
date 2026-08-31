import crypto from 'node:crypto';

export interface IssuedCapabilityToken {
  token: string;
  sessionId: string;
  capabilities: string[];
  expiresAt: number;
}

export class CapabilityTokenIssuer {
  private readonly secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  public issue(sessionId: string, capabilities: string[], ttlMs = 3600 * 1000): IssuedCapabilityToken {
    const expiresAt = Date.now() + ttlMs;
    const rawPayload = `${sessionId}:${capabilities.sort().join(',')}:${expiresAt}`;
    const hmac = crypto.createHmac('sha256', this.secretKey).update(rawPayload).digest('hex').slice(0, 32);
    const token = `cap_${sessionId}_${expiresAt}_${hmac}`;

    return {
      token,
      sessionId,
      capabilities: [...capabilities],
      expiresAt,
    };
  }
}
