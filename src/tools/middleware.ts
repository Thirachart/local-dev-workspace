import {
  parseCommonRequest,
  createSuccessResponse,
  createFailureResponse,
} from '../core/envelope.js';
import { SnapshotManager } from '../core/snapshotManager.js';
import { ProjectPermissionGuard, ProjectCapabilities } from '../core/permissions.js';
import { AuditLogger } from '../core/auditLogger.js';

export interface ToolDefinition<TReq extends Record<string, any> = any, TRes = any> {
  name: string;
  capability?: keyof ProjectCapabilities;
  mutation?: boolean;
  handler: (req: TReq, context: { snapshotBefore?: string }) => Promise<TRes>;
}

export interface MiddlewareContext {
  snapshotManager?: SnapshotManager;
  permissionGuard?: ProjectPermissionGuard;
}

export function withV2Envelope<TReq extends Record<string, any>, TRes>(
  toolDefOrHandler:
    | ToolDefinition<TReq, TRes>
    | ((req: TReq, context: { snapshotBefore?: string }) => Promise<TRes>),
  snapshotManager?: SnapshotManager,
  permissionGuard?: ProjectPermissionGuard,
  options?: { action?: keyof ProjectCapabilities; isMutation?: boolean }
) {
  const isDef = typeof toolDefOrHandler === 'object';
  const name = isDef ? toolDefOrHandler.name : 'anonymous_tool';
  const action = isDef ? toolDefOrHandler.capability : options?.action;
  const isMutation = isDef ? Boolean(toolDefOrHandler.mutation) : Boolean(options?.isMutation);
  const handler = isDef ? toolDefOrHandler.handler : toolDefOrHandler;

  const auditLogger = AuditLogger.getInstance();

  return async (rawArgs: TReq) => {
    const startTime = Date.now();

    // 1. Schema & Version Parsing
    let common;
    try {
      common = parseCommonRequest(rawArgs, { isMutation });
    } catch (err: any) {
      const failure = createFailureResponse(
        {
          category: err.category || 'validation',
          code: err.code || 'INVALID_REQUEST',
          message: err.message,
          retryable: false,
        },
        {
          project: 'default',
          cwd: '.',
          durationMs: Date.now() - startTime,
        }
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(failure, null, 2) }],
        isError: true,
      };
    }

    // 2. Permission Guard Assertion at Middleware Layer
    if (permissionGuard && action) {
      try {
        permissionGuard.assertAllowed(action, (rawArgs as any).path || (rawArgs as any).targetPath, {
          project: common.project,
          customCwd: common.cwd,
        });
      } catch (err: any) {
        const failure = createFailureResponse(
          {
            category: err.category || 'permission',
            code: err.code || 'PERMISSION_DENIED',
            message: err.message,
            retryable: false,
          },
          {
            project: common.project || 'default',
            cwd: common.cwd || '.',
            durationMs: Date.now() - startTime,
          }
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(failure, null, 2) }],
          isError: true,
        };
      }
    }

    // 3. Snapshot / Staleness Guard
    let snapshotBefore: string | undefined;
    if (snapshotManager) {
      const obs = await snapshotManager.getObservationToken(common.cwd, common.project);
      snapshotBefore = obs.snapshotId;

      if (common.expectedSnapshotId && obs.snapshotId !== common.expectedSnapshotId) {
        const failure = createFailureResponse(
          {
            category: 'conflict',
            code: 'STALE_SNAPSHOT',
            message: `Workspace state shifted. Expected snapshot "${common.expectedSnapshotId}" but found "${obs.snapshotId}".`,
            retryable: true,
            details: { expectedSnapshotId: common.expectedSnapshotId, currentSnapshotId: obs.snapshotId },
          },
          {
            project: common.project || 'default',
            cwd: common.cwd || '.',
            snapshotId: obs.snapshotId,
            durationMs: Date.now() - startTime,
          }
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(failure, null, 2) }],
          isError: true,
        };
      }
    }

    // 4. Execute Tool Handler
    try {
      const data = await handler(rawArgs, { snapshotBefore });

      let snapshotAfter: string | undefined;
      if (isMutation && snapshotManager) {
        const obsAfter = await snapshotManager.getObservationToken(common.cwd, common.project);
        snapshotAfter = obsAfter.snapshotId;
      }

      // 5. Automatic Audit Logging for Mutations
      if (isMutation) {
        auditLogger.logMutation({
          operationId: `op_${Date.now()}`,
          project: common.project || 'default',
          tool: name,
          targetPaths: [(rawArgs as any).path || (rawArgs as any).targetPath || 'workspace'].filter(Boolean),
          beforeHashes: {},
          afterHashes: {},
          snapshotBefore,
          snapshotAfter,
          durationMs: Date.now() - startTime,
        });
      }

      const response = createSuccessResponse(data, {
        project: common.project || 'default',
        cwd: common.cwd || '.',
        snapshotId: snapshotBefore,
        snapshotBefore,
        snapshotAfter,
        durationMs: Date.now() - startTime,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
      };
    } catch (err: any) {
      const failure = createFailureResponse(
        {
          category: err.category || 'internal',
          code: err.code || 'INTERNAL_ERROR',
          message: err.message || 'Operation failed',
          retryable: err.retryable ?? false,
          details: err.details,
        },
        {
          project: common.project || 'default',
          cwd: common.cwd || '.',
          snapshotId: snapshotBefore,
          durationMs: Date.now() - startTime,
        }
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(failure, null, 2) }],
        isError: true,
      };
    }
  };
}
