import { parseCommonRequest } from '../core/envelope.js';
import type { SessionManager } from './sessionManager.js';
import type { SessionContext } from './sessionContext.js';
import { hasCapability } from './sessionContext.js';

export interface SessionRequest extends Record<string, unknown> {
  sessionId?: string;
  capabilityToken?: any;
}

export class SessionMiddleware {
  constructor(private readonly sessions: SessionManager) {}

  resolve(raw: SessionRequest, requiredCapability?: string): SessionContext {
    const request = parseCommonRequest(raw);
    const session = raw.sessionId ? this.sessions.get(raw.sessionId) : undefined;

    if (raw.sessionId && !session) {
      const error: any = new Error('Session not found or revoked.');
      error.code = 'INVALID_SESSION';
      error.category = 'permission';
      throw error;
    }

    const context: SessionContext = {
      session,
      token: raw.capabilityToken,
      workspaceId: session?.workspaceId,
      snapshotId: request.expectedSnapshotId,
    };

    if (requiredCapability && !hasCapability(context, requiredCapability)) {
      const error: any = new Error(`Missing capability: ${requiredCapability}`);
      error.code = 'CAPABILITY_DENIED';
      error.category = 'permission';
      throw error;
    }

    return context;
  }
}
