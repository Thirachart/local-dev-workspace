import crypto from 'node:crypto';
import { ProjectService } from './projectService.js';
import { GitAccessStatus, GitService } from './gitService.js';
import { MemoryService } from './memoryService.js';

export interface ProjectSnapshot {
  project: {
    name: string;
    rootPath: string;
    pathScope: 'absolute' | 'project-root';
    isGitRepo: boolean;
    gitAccess: GitAccessStatus;
    gitErrorCode?: string;
    gitError?: string;
  };
  git: {
    access: GitAccessStatus;
    errorCode?: string;
    error?: string;
    branch: string;
    headCommit: string;
    isDirty: boolean | null;
    modifiedCount: number;
    untrackedCount: number;
    stagedCount: number;
    deletedCount: number;
    changedCount: number;
    ahead: number;
    behind: number;
    recentCommits: Array<{
      hash: string;
      message: string;
      author: string;
      date: string;
    }>;
  };
  instructions: {
    files: string[];
    contentHash: string;
    unchanged: boolean;
    content?: string;
  };
  handoff: {
    hasHandoff: boolean;
    updatedAt?: string;
    summary?: string;
    nextSteps?: string[];
  };
  snapshotFingerprint: string;
  timestamp: string;
}

export class SnapshotService {
  private projectService: ProjectService;
  private gitService: GitService;
  private memoryService: MemoryService;

  constructor(
    projectService: ProjectService,
    gitService: GitService,
    memoryService: MemoryService
  ) {
    this.projectService = projectService;
    this.gitService = gitService;
    this.memoryService = memoryService;
  }

  public async getSnapshot(options?: {
    knownInstructionHash?: string;
    customCwd?: string;
    project?: string;
    sessionId?: string;
    compact?: boolean;
  }): Promise<ProjectSnapshot> {
    if (!options?.project) {
      throw new Error('Snapshot requires explicit project.');
    }
    const targetProject = this.projectService.getRequiredProject(options.project);
    const rootPath = this.projectService.resolveWorkingDir(options?.customCwd, options.project);

    // 1. Fetch Git status & recent commits
    let gitInfo = {
      access: 'unavailable' as GitAccessStatus,
      errorCode: undefined as string | undefined,
      error: undefined as string | undefined,
      branch: 'unknown',
      headCommit: 'unknown',
      isDirty: null as boolean | null,
      modifiedCount: 0,
      untrackedCount: 0,
      stagedCount: 0,
      deletedCount: 0,
      changedCount: 0,
      ahead: 0,
      behind: 0,
      recentCommits: [] as Array<{ hash: string; message: string; author: string; date: string }>,
    };

    let isGit = false;
    try {
      const statusRes = await this.gitService.getStatus({ customCwd: rootPath, project: targetProject?.name });
      isGit = statusRes.isGitRepo;
      gitInfo.access = statusRes.gitAccess;
      gitInfo.errorCode = statusRes.errorCode;
      gitInfo.error = statusRes.error;
      if (isGit && statusRes.gitAccess === 'available') {
        gitInfo.branch = statusRes.branch || 'HEAD';
        const modified = statusRes.summary?.modified?.length || 0;
        const untracked = statusRes.summary?.untracked?.length || 0;
        const staged = statusRes.summary?.staged?.length || 0;
        const deleted = statusRes.summary?.deleted?.length || 0;
        const changedCount = statusRes.changedCount ?? (modified + untracked + staged);
        gitInfo.isDirty = changedCount > 0;
        gitInfo.modifiedCount = statusRes.modifiedCount ?? modified;
        gitInfo.untrackedCount = statusRes.untrackedCount ?? untracked;
        gitInfo.stagedCount = statusRes.stagedCount ?? staged;
        gitInfo.deletedCount = statusRes.deletedCount ?? deleted;
        gitInfo.changedCount = changedCount;
        gitInfo.ahead = statusRes.ahead ?? 0;
        gitInfo.behind = statusRes.behind ?? 0;

        const logRes = await this.gitService.getLog({ maxCount: 3, customCwd: rootPath, project: targetProject?.name });
        gitInfo.recentCommits = logRes.commits.map((c) => ({
          hash: c.hash,
          message: c.message,
          author: c.author,
          date: c.date,
        }));
        if (gitInfo.recentCommits.length > 0) {
          gitInfo.headCommit = gitInfo.recentCommits[0].hash;
        }
      }
    } catch {
      gitInfo.access = 'unavailable';
      gitInfo.errorCode = 'GIT_UNAVAILABLE';
      gitInfo.error = 'Git repository status is unavailable.';
    }

    // 2. Fetch Instructions & calculate SHA256 Hash
    const instructionRes = this.memoryService.findProjectInstructionsSync(rootPath);
    const instructionFiles = instructionRes.exists && instructionRes.fileName ? [instructionRes.fileName] : [];
    const rawInstructions = instructionRes.content || '';
    const contentHash = crypto.createHash('sha256').update(rawInstructions, 'utf-8').digest('hex');

    const isUnchanged = Boolean(
      options?.knownInstructionHash &&
      options.knownInstructionHash.trim().toLowerCase() === contentHash.toLowerCase()
    );

    const isCompact = options?.compact === true;

    let instructionContent: string | undefined = undefined;
    if (!isCompact && !isUnchanged) {
      const maxLen = 2500;
      if (rawInstructions.length > maxLen) {
        instructionContent = rawInstructions.slice(0, maxLen) + `\n\n... [Truncated ${rawInstructions.length - maxLen} chars. Use read_project_instructions for full content]`;
      } else {
        instructionContent = rawInstructions || '(No project instructions found)';
      }
    }

    // 3. Fetch Handoff
    const handoffData = await this.memoryService.readHandoff(rootPath);
    let handoffSummary: string | undefined = handoffData.content || undefined;
    if (isCompact) {
      handoffSummary = undefined;
    } else if (handoffSummary) {
      const maxHandoffLen = 2000;
      if (handoffSummary.length > maxHandoffLen) {
        handoffSummary = handoffSummary.slice(0, maxHandoffLen) + `\n\n... [Truncated ${handoffSummary.length - maxHandoffLen} chars. Use read_handoff for full content]`;
      }
    }

    return {
      project: {
        name: targetProject?.name || 'Default Workspace',
        rootPath: isCompact ? '.' : rootPath,
        pathScope: isCompact ? 'project-root' : 'absolute',
        isGitRepo: isGit,
        gitAccess: gitInfo.access,
        gitErrorCode: gitInfo.errorCode,
        gitError: gitInfo.error,
      },
      git: gitInfo,
      instructions: {
        files: instructionFiles,
        contentHash,
        unchanged: isCompact ? true : isUnchanged,
        content: instructionContent,
      },
      handoff: {
        hasHandoff: handoffData.exists,
        summary: handoffSummary,
      },
      snapshotFingerprint: `${gitInfo.headCommit.slice(0, 10)}:${contentHash.slice(0, 10)}`,
      timestamp: new Date().toISOString(),
    };
  }
}
