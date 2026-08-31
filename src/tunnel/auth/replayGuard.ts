import { TunnelError } from '../protocol/errors.js';

export interface NonceRecord {
  nonce: string;
  timestamp: number;
}

export class ReplayGuard {
  private nonces = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) { // 5 minutes default
    this.ttlMs = ttlMs;
  }

  public verifyAndRecord(nonce: string, timestamp?: number): void {
    if (!nonce || typeof nonce !== 'string' || nonce.trim().length < 8) {
      throw new TunnelError('INVALID_NONCE', 'auth', 'Nonce must be a non-empty string of at least 8 characters.');
    }

    const now = Date.now();
    // Verify timestamp drift if provided (max 5 minutes)
    if (timestamp && Math.abs(now - timestamp) > this.ttlMs) {
      throw new TunnelError('TIMESTAMP_OUT_OF_RANGE', 'auth', 'Request timestamp has drifted beyond allowed replay window.');
    }

    this.prune(now);

    if (this.nonces.has(nonce)) {
      throw new TunnelError('REPLAY_ATTACK_DETECTED', 'auth', `Nonce '${nonce}' has already been used within the replay window.`);
    }

    this.nonces.set(nonce, now);
  }

  public has(nonce: string): boolean {
    const ts = this.nonces.get(nonce);
    if (!ts) return false;
    if (Date.now() - ts > this.ttlMs) {
      this.nonces.delete(nonce);
      return false;
    }
    return true;
  }

  public prune(now = Date.now()): number {
    let pruned = 0;
    for (const [nonce, ts] of this.nonces.entries()) {
      if (now - ts > this.ttlMs) {
        this.nonces.delete(nonce);
        pruned++;
      }
    }
    return pruned;
  }

  public clear(): void {
    this.nonces.clear();
  }

  public get size(): number {
    return this.nonces.size;
  }
}
