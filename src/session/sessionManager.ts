import crypto from 'node:crypto';
import type { WorkspaceIdentity } from './workspaceIdentity.js';

export interface AgentSession {
  sessionId: string;
  workspaceId: string;
  capabilities: string[];
  createdAt: string;
}

export class SessionManager {
  private sessions = new Map<string, AgentSession>();

  create(workspace: WorkspaceIdentity, capabilities: string[] = ['read']): AgentSession {
    const session: AgentSession = {
      sessionId: `sess_${crypto.randomBytes(8).toString('hex')}`,
      workspaceId: workspace.workspaceId,
      capabilities: [...capabilities],
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  revoke(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}
