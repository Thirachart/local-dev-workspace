import type { AgentSession } from './sessionManager.js';

export class SessionStore {
  private store = new Map<string, AgentSession>();

  save(session: AgentSession): void {
    this.store.set(session.sessionId, session);
  }

  load(sessionId: string): AgentSession | undefined {
    return this.store.get(sessionId);
  }

  remove(sessionId: string): void {
    this.store.delete(sessionId);
  }
}
