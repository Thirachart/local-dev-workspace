import { execFile } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getGitTrackingStatus, GitDivergence } from '../git-intel/trackingStatus.js';
import { ProjectService } from './projectService.js';

const execFileAsync = util.promisify(execFile);

export type GitAccessStatus = 'available' | 'denied' | 'unavailable' | 'not-a-repository';

export class GitService {
  private projectService?: ProjectService;
  private baseDir: string;

  constructor(baseDir: string = process.cwd(), projectService?: ProjectService) {
    this.baseDir = path.resolve(baseDir);
    this.projectService = projectService;
  }

  private resolveCwd(customCwd?: string, projectName?: string): string {
    if (this.projectService) {
      return this.projectService.resolveWorkingDir(customCwd, projectName);
    }
    if (!customCwd) return this.baseDir;
    if (path.isAbsolute(customCwd)) return path.resolve(customCwd);
    return path.resolve(this.baseDir, customCwd);
  }

  /**
   * Git refuses to inspect repositories owned by another Windows identity
   * before it can answer rev-parse. Detect the repository marker directly so
   * callers can distinguish "not a repository" from "repository detected but
   * Git access denied" without weakening Git's safe.directory protection.
   */
  private async findRepositoryRoot(cwd: string): Promise<string | undefined> {
    let current = path.resolve(cwd);

    while (true) {
      try {
        await fs.lstat(path.join(current, '.git'));
        return current;
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return undefined;
        current = parent;
      }
    }
  }

  private formatGitError(err: any): string {
    const parts = [err?.stderr, err?.stdout, err?.message]
      .filter((value) => value !== undefined && value !== null && String(value).trim())
      .map((value) => String(value).trim());
    return [...new Set(parts)].join('\n') || String(err);
  }

  private classifyGitError(error: string, repositoryRoot?: string): {
    gitAccess: GitAccessStatus;
    errorCode: string;
  } {
    if (/dubious ownership|safe\.directory/i.test(error)) {
      return { gitAccess: 'denied', errorCode: 'GIT_DUBIOUS_OWNERSHIP' };
    }

    if (/permission denied|access is denied|operation not permitted/i.test(error)) {
      return { gitAccess: 'denied', errorCode: 'GIT_ACCESS_DENIED' };
    }

    if (/not a git repository/i.test(error)) {
      return repositoryRoot
        ? { gitAccess: 'unavailable', errorCode: 'GIT_INVALID_REPOSITORY' }
        : { gitAccess: 'not-a-repository', errorCode: 'GIT_NOT_A_REPOSITORY' };
    }

    return repositoryRoot
      ? { gitAccess: 'unavailable', errorCode: 'GIT_UNAVAILABLE' }
      : { gitAccess: 'not-a-repository', errorCode: 'GIT_NOT_A_REPOSITORY' };
  }

  private async unavailableGitState(cwd: string, err: any): Promise<{
    isGitRepo: boolean;
    gitAccess: GitAccessStatus;
    errorCode: string;
    error: string;
    repositoryRoot?: string;
  }> {
    const repositoryRoot = await this.findRepositoryRoot(cwd);
    const error = this.formatGitError(err);
    const classification = this.classifyGitError(error, repositoryRoot);

    return {
      isGitRepo: Boolean(repositoryRoot),
      gitAccess: classification.gitAccess,
      errorCode: classification.errorCode,
      error,
      repositoryRoot,
    };
  }

  public async getStatus(options?: string | { customCwd?: string; project?: string }): Promise<{
    isGitRepo: boolean;
    gitAccess: GitAccessStatus;
    errorCode?: string;
    repositoryRoot?: string;
    branch?: string;
    statusOutput?: string;
    summary?: {
      modified: string[];
      untracked: string[];
      staged: string[];
      deleted: string[];
    };
    modifiedCount?: number;
    untrackedCount?: number;
    stagedCount?: number;
    deletedCount?: number;
    changedCount?: number;
    upstream?: string;
    ahead?: number;
    behind?: number;
    divergence?: GitDivergence;
    error?: string;
  }> {
    const customCwd = typeof options === 'string' ? options : options?.customCwd;
    const project = typeof options === 'object' ? options?.project : undefined;
    const cwd = this.resolveCwd(customCwd, project);
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
      let branch = 'HEAD';
      try {
        const { stdout } = await execFileAsync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd });
        branch = stdout.trim() || 'HEAD';
      } catch {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
        branch = stdout.trim() || 'HEAD';
      }
      const { stdout: status } = await execFileAsync('git', ['status', '--short'], { cwd });
      const tracking = await getGitTrackingStatus(cwd);

      const modified: string[] = [];
      const untracked: string[] = [];
      const staged: string[] = [];
      const deleted: string[] = [];

      const lines = status.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const x = line[0];
        const y = line[1];
        const file = line.substring(3).trim();

        if (x === '?' && y === '?') {
          untracked.push(file);
        } else {
          if (x !== ' ' && x !== '?') staged.push(file);
          if (y === 'M') modified.push(file);
          if (y === 'D' || x === 'D') deleted.push(file);
        }
      }

      return {
        isGitRepo: true,
        gitAccess: 'available',
        repositoryRoot: await this.findRepositoryRoot(cwd),
        branch,
        statusOutput: status.trim() || 'Working tree clean',
        summary: {
          modified,
          untracked,
          staged,
          deleted,
        },
        modifiedCount: modified.length,
        untrackedCount: untracked.length,
        stagedCount: staged.length,
        deletedCount: deleted.length,
        changedCount: lines.length,
        upstream: tracking.upstream,
        ahead: tracking.ahead,
        behind: tracking.behind,
        divergence: tracking.divergence,
      };
    } catch (err: any) {
      return this.unavailableGitState(cwd, err);
    }
  }

  public async getDiff(customCwd?: string, staged: boolean = false, projectName?: string): Promise<{
    diff: string;
    isGitRepo: boolean;
    gitAccess: GitAccessStatus;
    errorCode?: string;
    error?: string;
  }> {
    const cwd = this.resolveCwd(customCwd, projectName);
    try {
      const args = staged ? ['diff', '--cached'] : ['diff'];
      const { stdout } = await execFileAsync('git', args, { cwd });
      return {
        isGitRepo: true,
        gitAccess: 'available',
        diff: stdout.trim() || '(No diff changes)',
      };
    } catch (err: any) {
      const unavailable = await this.unavailableGitState(cwd, err);
      return {
        ...unavailable,
        diff: `Git diff error: ${unavailable.error}`,
      };
    }
  }

  public async getLog(options?: { maxCount?: number; customCwd?: string; project?: string }): Promise<{
    isGitRepo: boolean;
    gitAccess: GitAccessStatus;
    errorCode?: string;
    repositoryRoot?: string;
    commits: Array<{
      hash: string;
      shortHash: string;
      author: string;
      date: string;
      message: string;
    }>;
    totalCount: number;
    error?: string;
  }> {
    const cwd = this.resolveCwd(options?.customCwd, options?.project);
    const count = options?.maxCount || 10;
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
      try {
        await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd });
      } catch {
        return {
          isGitRepo: true,
          gitAccess: 'available',
          commits: [],
          totalCount: 0,
        };
      }
      const { stdout } = await execFileAsync(
        'git',
        ['log', `-n`, `${count}`, `--pretty=format:%H|%an|%ad|%s`, `--date=short`],
        { cwd }
      );

      const lines = stdout.split(/\r?\n/).filter(Boolean);
      const commits = lines.map((l) => {
        const [hash, author, date, ...msgParts] = l.split('|');
        return {
          hash: hash?.trim() || '',
          shortHash: (hash?.trim() || '').substring(0, 7),
          author: author?.trim() || '',
          date: date?.trim() || '',
          message: msgParts.join('|').trim(),
        };
      });

      return {
        isGitRepo: true,
        gitAccess: 'available',
        repositoryRoot: await this.findRepositoryRoot(cwd),
        commits,
        totalCount: commits.length,
      };
    } catch (err: any) {
      const unavailable = await this.unavailableGitState(cwd, err);
      return {
        ...unavailable,
        commits: [],
        totalCount: 0,
      };
    }
  }

  public async commit(options: {
    message: string;
    files?: string[];
    customCwd?: string;
    project?: string;
  }): Promise<{
    success: boolean;
    commitHash?: string;
    message?: string;
    filesCommitted?: string[];
    error?: string;
  }> {
    const cwd = this.resolveCwd(options?.customCwd, options?.project);
    if (!options.message || !options.message.trim()) {
      throw new Error('Commit message is required.');
    }

    try {
      // 1. Stage files
      const filesToAdd = options.files && options.files.length > 0 ? options.files : ['.'];
      await execFileAsync('git', ['add', ...filesToAdd], { cwd });

      // 2. Commit
      const { stdout } = await execFileAsync('git', ['commit', '-m', options.message.trim()], { cwd });

      // 3. Get latest commit hash
      const { stdout: hashOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });

      return {
        success: true,
        commitHash: hashOut.trim().substring(0, 7),
        message: options.message.trim(),
        filesCommitted: filesToAdd,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Git commit failed: ${err.message}`,
      };
    }
  }
}

