import path from 'node:path';
import { ProjectService } from './projectService.js';
import { GitAccessStatus, GitService } from './gitService.js';
import { DiagnosticService } from './diagnosticService.js';
import { ProcessService } from './processService.js';
import { MemoryService } from './memoryService.js';

export interface WorkspaceHealthReport {
  timestamp: string;
  project: {
    name: string;
    path: string;
    permissions: {
      canRead: boolean;
      canWrite: boolean;
      canRunCommand: boolean;
      canDelete?: boolean;
    };
  };
  git: {
    isGitRepo: boolean;
    gitAccess: GitAccessStatus;
    branch: string;
    isClean: boolean;
    modifiedCount: number;
    stagedCount: number;
    untrackedCount: number;
    changedCount: number;
    ahead: number;
    behind: number;
    errorCode?: string;
    error?: string;
  };
  diagnostics: {
    status: 'clean' | 'has_errors' | 'failed' | 'unknown';
    errorCount: number;
    warningCount: number;
    topErrors: Array<{ file?: string; line?: number; message: string }>;
  };
  runningProcesses: Array<{
    id: string;
    command: string;
    status: string;
    uptimeMs: number;
  }>;
  memory: {
    hasHandoff: boolean;
    hasInstructions: boolean;
  };
  overallStatus: 'healthy' | 'needs_attention' | 'error';
  summary: string;
}

export class WorkspaceHealthService {
  private projectService: ProjectService;
  private gitService: GitService;
  private diagnosticService: DiagnosticService;
  private processService: ProcessService;
  private memoryService: MemoryService;
  private baseDir: string;

  constructor(
    projectService: ProjectService,
    gitService: GitService,
    diagnosticService: DiagnosticService,
    processService: ProcessService,
    memoryService: MemoryService,
    baseDir: string = process.cwd()
  ) {
    this.projectService = projectService;
    this.gitService = gitService;
    this.diagnosticService = diagnosticService;
    this.processService = processService;
    this.memoryService = memoryService;
    this.baseDir = path.resolve(baseDir);
  }

  public async getHealth(options: { customCwd?: string; project: string }): Promise<WorkspaceHealthReport> {
    const projectContext = this.projectService.getRequiredProject(options.project);
    const targetDir = projectContext.path;

    // 1. Gather Git Status
    let gitInfo = {
      isGitRepo: false,
      gitAccess: 'unavailable' as GitAccessStatus,
      branch: 'unknown',
      isClean: false,
      modifiedCount: 0,
      stagedCount: 0,
      untrackedCount: 0,
      changedCount: 0,
      ahead: 0,
      behind: 0,
      errorCode: undefined as string | undefined,
      error: undefined as string | undefined,
    };
    try {
      const gitStatus = await this.gitService.getStatus({ customCwd: options?.customCwd, project: options?.project });
      if (gitStatus.isGitRepo && gitStatus.gitAccess === 'available') {
        const modifiedCount = gitStatus.modifiedCount ?? (gitStatus.summary?.modified?.length || 0);
        const stagedCount = gitStatus.stagedCount ?? (gitStatus.summary?.staged?.length || 0);
        const untrackedCount = gitStatus.untrackedCount ?? (gitStatus.summary?.untracked?.length || 0);
        const changedCount = gitStatus.changedCount ?? (modifiedCount + stagedCount + untrackedCount);
        const isClean = changedCount === 0;

        gitInfo = {
          isGitRepo: true,
          gitAccess: 'available',
          branch: gitStatus.branch || 'HEAD',
          isClean,
          modifiedCount,
          stagedCount,
          untrackedCount,
          changedCount,
          ahead: gitStatus.ahead ?? 0,
          behind: gitStatus.behind ?? 0,
          errorCode: undefined,
          error: undefined,
        };
      } else if (gitStatus.isGitRepo) {
        gitInfo = {
          isGitRepo: true,
          gitAccess: gitStatus.gitAccess,
          branch: 'unknown',
          isClean: false,
          modifiedCount: 0,
          stagedCount: 0,
          untrackedCount: 0,
          changedCount: 0,
          ahead: 0,
          behind: 0,
          errorCode: gitStatus.errorCode,
          error: gitStatus.error || 'Git repository detected, but Git access is unavailable.',
        };
      } else {
        gitInfo.gitAccess = gitStatus.gitAccess;
        gitInfo.errorCode = gitStatus.errorCode;
        gitInfo.error = gitStatus.error || 'Git repository status is unavailable.';
      }
    } catch (err: any) {
      gitInfo.gitAccess = 'unavailable';
      gitInfo.errorCode = 'GIT_UNAVAILABLE';
      gitInfo.error = err.message || String(err);
    }

    // 2. Gather TypeScript/Linter Diagnostics
    let diagInfo = {
      status: 'unknown' as 'clean' | 'has_errors' | 'failed' | 'unknown',
      errorCount: 0,
      warningCount: 0,
      topErrors: [] as Array<{ file?: string; line?: number; message: string }>,
    };
    try {
      const diagResult = await this.diagnosticService.runDiagnostics('typecheck', {
        customCwd: options?.customCwd,
        project: options?.project,
      });
      if ('errorCount' in diagResult) {
        const diagnosticStatus = diagResult.status === 'not_configured'
          ? 'unknown'
          : !diagResult.success && diagResult.errorCount === 0
            ? 'failed'
            : diagResult.errorCount > 0
              ? 'has_errors'
              : 'clean';
        diagInfo = {
          status: diagnosticStatus,
          errorCount: diagResult.errorCount,
          warningCount: diagResult.warningCount,
          topErrors: diagResult.structuredErrors.slice(0, 5).map((d) => ({
            file: d.file,
            line: d.line,
            message: d.message,
          })),
        };
      }
    } catch {}

    // 3. Gather Active Running Processes
    const allTasks = this.processService.listTasks(options.project);
    const runningProcs = allTasks
      .filter((t) => t.status === 'running')
      .map((t) => ({
        id: t.id,
        command: t.command,
        status: t.status,
        uptimeMs: t.runningTimeMs,
      }));

    // 4. Memory & Handoff Checks
    const handoff = await this.memoryService.readHandoff(targetDir);
    const instructions = this.memoryService.findProjectInstructionsSync(targetDir);

    let overallStatus: 'healthy' | 'needs_attention' | 'error' = 'healthy';
    if (diagInfo.status === 'has_errors' || diagInfo.status === 'failed') {
      overallStatus = 'error';
    } else if (!gitInfo.isGitRepo || gitInfo.gitAccess !== 'available' || !gitInfo.isClean || runningProcs.length > 0) {
      overallStatus = 'needs_attention';
    }

    const summaryParts: string[] = [];
    if (gitInfo.isGitRepo) {
      if (gitInfo.gitAccess !== 'available') {
        summaryParts.push(`Git: repository detected, access ${gitInfo.gitAccess}${gitInfo.error ? ` (${gitInfo.error})` : ''}`);
      } else {
        const changeLabel = gitInfo.changedCount === 1 ? 'change' : 'changes';
        summaryParts.push(`Branch: ${gitInfo.branch} (${gitInfo.isClean ? 'clean' : `${gitInfo.changedCount} uncommitted ${changeLabel}`})`);
      }
    } else {
      summaryParts.push(`Git: unavailable${gitInfo.error ? ` (${gitInfo.error})` : ''}`);
    }
    summaryParts.push(
      diagInfo.status === 'unknown'
        ? 'Diagnostics: unavailable'
        : diagInfo.status === 'failed'
          ? 'Diagnostics: command failed (no parsable compiler errors)'
          : `Diagnostics: ${diagInfo.errorCount === 0 ? '0 errors (healthy)' : `${diagInfo.errorCount} compiler errors`}`
    );
    if (runningProcs.length > 0) summaryParts.push(`Active background servers: ${runningProcs.length}`);
    if (handoff.content) summaryParts.push(`Active session handoff present`);

    return {
      timestamp: new Date().toISOString(),
      project: {
        name: projectContext.name || path.basename(targetDir),
        path: targetDir,
        permissions: {
          canRead: projectContext.permissions?.canRead ?? true,
          canWrite: projectContext.permissions?.canWrite ?? true,
          canRunCommand: projectContext.permissions?.canRunCommand ?? true,
          canDelete: projectContext.permissions?.canDelete ?? true,
        },
      },
      git: gitInfo,
      diagnostics: diagInfo,
      runningProcesses: runningProcs,
      memory: {
        hasHandoff: Boolean(handoff.content),
        hasInstructions: Boolean(instructions.content),
      },
      overallStatus,
      summary: summaryParts.join(' | '),
    };
  }
}
