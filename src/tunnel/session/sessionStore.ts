import type { TunnelSession } from './tunnelSession.js';

export class TunnelSessionStore {
  private sessions = new Map<string, TunnelSession>();

  public set(session: TunnelSession): void {
    this.sessions.set(session.sessionId, session);
  }

  public get(sessionId: string): TunnelSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Check expiration on read
    if (session.expiresAt <= Date.now() && session.state === 'ACTIVE') {
      session.state = 'EXPIRED';
    }
    return session;
  }

  public delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  public listActive(): TunnelSession[] {
    const now = Date.now();
    const active: TunnelSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.state === 'ACTIVE' && session.expiresAt > now) {
        active.push(session);
      }
    }
    return active;
  }

  public listByWorkspace(workspaceId: string): TunnelSession[] {
    const matched: TunnelSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId && session.state === 'ACTIVE' && session.expiresAt > Date.now()) {
        matched.push(session);
      }
    }
    return matched;
  }

  public pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt <= now || session.state === 'EXPIRED' || session.state === 'REVOKED') {
        this.sessions.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  public clear(): void {
    this.sessions.clear();
  }

  public get size(): number {
    return this.sessions.size;
  }
}
