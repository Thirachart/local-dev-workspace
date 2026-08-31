import { CapabilityResolver } from '../auth/capabilityResolver.js';
import { TunnelSessionStore } from '../session/sessionStore.js';
import { MemoryRingAuditLogger } from '../audit/tunnelAudit.js';
import { TunnelError } from '../protocol/errors.js';
import type { RequestFrame, ResponseFrame, ErrorFrame } from '../protocol/protocol.js';
import { createResponseFrame, createErrorFrame } from '../protocol/validation.js';

export interface ToolExecutor {
  executeTool(name: string, params: Record<string, unknown>, context: { sessionId: string; workspaceId?: string; expectedSnapshotId?: string }): Promise<{ result: unknown; snapshotId?: string }>;
}

export class TunnelRouter {
  private readonly capabilityResolver: CapabilityResolver;
  private readonly sessionStore: TunnelSessionStore;
  private readonly auditLogger: MemoryRingAuditLogger;
  private readonly executor?: ToolExecutor;

  constructor(
    sessionStore: TunnelSessionStore,
    capabilityResolver: CapabilityResolver,
    auditLogger: MemoryRingAuditLogger,
    executor?: ToolExecutor
  ) {
    this.sessionStore = sessionStore;
    this.capabilityResolver = capabilityResolver;
    this.auditLogger = auditLogger;
    this.executor = executor;
  }

  public async routeRequest(request: RequestFrame): Promise<ResponseFrame | ErrorFrame> {
    const start = Date.now();
    const { sessionId, capabilityToken, tool, parameters, expectedSnapshotId, id: requestId } = request;

    try {
      // 1. Session Verification
      const session = this.sessionStore.get(sessionId);
      if (!session) {
        throw new TunnelError('SESSION_NOT_FOUND', 'auth', `Session '${sessionId}' was not found.`);
      }

      if (session.state !== 'ACTIVE' || session.expiresAt <= Date.now()) {
        session.state = 'EXPIRED';
        throw new TunnelError('SESSION_EXPIRED', 'auth', `Session '${sessionId}' has expired.`);
      }

      // 2. Capability Token Verification
      if (session.capabilityToken !== capabilityToken) {
        throw new TunnelError('CAPABILITY_TOKEN_MISMATCH', 'auth', 'Capability token does not match active session.');
      }

      // 3. Resolve & Assert Tool Capability
      const requiredCap = this.capabilityResolver.resolveRequiredCapability(tool);
      this.capabilityResolver.assertCapability(session.capabilities, requiredCap, tool);

      // 4. Execute via Tool Executor if provided
      let resultData: unknown = { executed: true, tool, parameters };
      let snapshotId = expectedSnapshotId;

      if (this.executor) {
        const execRes = await this.executor.executeTool(tool, parameters, {
          sessionId,
          workspaceId: session.workspaceId,
          expectedSnapshotId,
        });
        resultData = execRes.result;
        snapshotId = execRes.snapshotId;
      }

      const durationMs = Date.now() - start;

      // 5. Audit Log (Metadata Only - No Source Code)
      this.auditLogger.log({
        provider: 'tunnel-router',
        sessionId,
        workspaceId: session.workspaceId,
        action: 'tool_execution',
        tool,
        success: true,
        durationMs,
      });

      return createResponseFrame(requestId, true, resultData, snapshotId, durationMs);
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const code = err instanceof TunnelError ? err.code : 'EXECUTION_ERROR';
      const category = err instanceof TunnelError ? err.category : 'execution';

      this.auditLogger.log({
        provider: 'tunnel-router',
        sessionId,
        action: 'tool_execution_failed',
        tool,
        success: false,
        durationMs,
        errorCode: code,
      });

      return createErrorFrame(code, category, err.message, requestId, err.details);
    }
  }
}
