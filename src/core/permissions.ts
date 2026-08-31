import path from 'node:path';
import { ProjectService } from '../services/projectService.js';

export interface ProjectCapabilities {
  read: boolean;
  write: boolean;
  runCommands: boolean;
  gitCommit: boolean;
  gitPush: boolean;
  deleteBranches: boolean;
  network: boolean;
  allowedRoots?: string[];
}

export class ProjectPermissionGuard {
  constructor(private projectService?: ProjectService) {}

  public assertAllowed(
    action: keyof ProjectCapabilities,
    targetPath?: string,
    options?: { project?: string; customCwd?: string }
  ): void {
    if (!this.projectService) return;

    // Check project permission capabilities
    const mappedAction: 'read' | 'write' | 'command' =
      action === 'write' || action === 'deleteBranches'
        ? 'write'
        : action === 'runCommands' || action === 'gitCommit' || action === 'gitPush' || action === 'network'
          ? 'command'
          : 'read';

    const perm = this.projectService.checkPermission(
      mappedAction,
      options?.customCwd,
      options?.project
    );

    if (!perm.allowed) {
      const err: any = new Error(perm.reason || `[PERMISSION_DENIED] Action "${String(action)}" is not permitted.`);
      err.category = 'permission';
      err.code = 'PERMISSION_DENIED';
      throw err;
    }

    // Path jail verification if targetPath is given
    if (targetPath) {
      const resolved = this.projectService.resolveSafePath(targetPath, options?.customCwd, options?.project);
      if (!resolved) {
        const err: any = new Error(`[PERMISSION_DENIED] Path "${targetPath}" is outside the allowed project root boundary.`);
        err.category = 'permission';
        err.code = 'PERMISSION_DENIED';
        throw err;
      }
    }
  }
}
