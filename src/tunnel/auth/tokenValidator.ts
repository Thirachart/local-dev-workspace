import crypto from 'node:crypto';
import { TunnelError } from '../protocol/errors.js';

export interface ValidatedTokenResult {
  valid: boolean;
  sessionId: string;
  expiresAt: number;
}

export class CapabilityTokenValidator {
  private readonly secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  public validate(token: string, requiredCapabilities: string[] = []): ValidatedTokenResult {
    if (!token || typeof token !== 'string' || !token.startsWith('cap_')) {
      throw new TunnelError('INVALID_TOKEN_FORMAT', 'auth', 'Invalid capability token format.');
    }

    const parts = token.split('_');
    if (parts.length < 4) {
      throw new TunnelError('INVALID_TOKEN_STRUCTURE', 'auth', 'Malformed capability token.');
    }

    const sessionId = parts[1];
    const expiresAt = parseInt(parts[2], 10);
    const providedHmac = parts[3];

    if (isNaN(expiresAt) || expiresAt <= Date.now()) {
      throw new TunnelError('TOKEN_EXPIRED', 'auth', 'Capability token has expired.');
    }

    // Reconstruct expected HMAC for comparison
    // If capabilities are checked, verify HMAC against capabilities
    const expectedPayload = `${sessionId}:${requiredCapabilities.sort().join(',')}:${expiresAt}`;
    const expectedHmac = crypto.createHmac('sha256', this.secretKey).update(expectedPayload).digest('hex').slice(0, 32);

    const providedBuf = Buffer.from(providedHmac, 'utf-8');
    const expectedBuf = Buffer.from(expectedHmac, 'utf-8');

    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      throw new TunnelError('INVALID_TOKEN_SIGNATURE', 'auth', 'Capability token signature verification failed.');
    }

    return {
      valid: true,
      sessionId,
      expiresAt,
    };
  }
}
