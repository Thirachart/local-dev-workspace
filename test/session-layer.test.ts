import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceIdentity } from '../src/session/workspaceIdentity.js';
import { SessionManager } from '../src/session/sessionManager.js';
import { issueCapabilityToken } from '../src/session/capabilityToken.js';
import { SessionMiddleware } from '../src/session/sessionMiddleware.js';

describe('Session Layer', () => {
  it('binds session to workspace and validates capability', () => {
    const workspace = createWorkspaceIdentity('/tmp/demo');
    const manager = new SessionManager();
    const session = manager.create(workspace, ['write']);
    const token = issueCapabilityToken(session.sessionId, ['write']);
    const middleware = new SessionMiddleware(manager);

    const context = middleware.resolve({
      sessionId: session.sessionId,
      capabilityToken: token,
    }, 'write');

    assert.equal(context.workspaceId, workspace.workspaceId);
  });

  it('rejects revoked sessions', () => {
    const manager = new SessionManager();
    manager.revoke('sess_missing');
    assert.throws(() => {
      new SessionMiddleware(manager).resolve({ sessionId: 'sess_missing' });
    }, /Session not found/);
  });
});
