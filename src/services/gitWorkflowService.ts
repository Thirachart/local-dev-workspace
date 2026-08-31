import path from 'node:path';
import { getGitTrackingStatus } from '../git-intel/trackingStatus.js';
import { ProcessService } from './processService.js';
import { ProjectService } from './projectService.js';

export interface WorktreeInfo {
  path: string;
  relativePath: string;
  head: string;
  branch: string;
  isBare: boolean;
  isLocked: boolean;
  isCurrent: boolean;
}

export interface GitSyncStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  isClean: boolean;
  unpushedCommits: string[];
  divergence: 'up-to-date' | 'ahead' | 'behind' | 'diverged' | 'no-upstream';
  fingerprint: string;
}

export interface BranchComparison {
  baseBranch: string;
  targetBranch: string;
  mergeBase: string;
  aheadCount: number;
  behindCount: number;
  commits: Array<{ hash: string; message: string }>;
  filesChangedCount: number;
  diffSummary: string;
}

export class GitWorkflowService {
  private processService: ProcessService;
  private projectService?: ProjectService;
  private baseDir: string;

  constructor(processService: ProcessService, baseDir: string = process.cwd(), projectService?: ProjectService) {
    this.processService = processService;
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

  public async getWorkspaceFingerprint(customCwd?: string, project?: string): Promise<{ head: string; tree: string; fingerprint: string }> {
    const cwd = this.resolveCwd(customCwd, project);
    const repoRes = await this.processService.runCommand({ command: 'git rev-parse --is-inside-work-tree', cwd, projectName: project });
    const headRes = await this.processService.runCommand({ command: 'git rev-parse HEAD', cwd, projectName: project });
    const branchRes = await this.processService.runCommand({ command: 'git branch --show-current', cwd, projectName: project });
    const isUnborn = repoRes.exitCode === 0 && headRes.exitCode !== 0;
    const head = headRes.exitCode === 0
      ? headRes.stdout.trim()
      : isUnborn
        ? `unborn:${branchRes.stdout.trim() || 'HEAD'}`
        : 'unknown';
    
    // Quick index/tree hash
    const treeRes = await this.processService.runCommand({
      command: isUnborn ? 'git write-tree' : 'git rev-parse HEAD^{tree}',
      cwd,
      projectName: project,
    });
    const tree = treeRes.exitCode === 0 ? treeRes.stdout.trim() : 'unknown';

    return {
      head,
      tree,
      fingerprint: `${head.slice(0, 10)}:${tree.slice(0, 10)}`,
    };
  }

  public async listWorktrees(customCwd?: string, project?: string): Promise<{ total: number; worktrees: WorktreeInfo[] }> {
    const cwd = this.resolveCwd(customCwd, project);
    const res = await this.processService.runCommand({ command: 'git worktree list --porcelain', cwd, projectName: project });
    if (res.exitCode !== 0) {
      throw new Error(`Failed to list git worktrees: ${res.stderr || res.stdout}`);
    }

    const lines = res.stdout.split(/\r?\n/);
    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    const normCwd = path.resolve(cwd).toLowerCase().replace(/\\/g, '/');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (current.path) {
          const normPath = path.resolve(current.path).toLowerCase().replace(/\\/g, '/');
          worktrees.push({
            path: current.path,
            relativePath: path.relative(this.baseDir, current.path).replace(/\\/g, '/') || '.',
            head: current.head || 'unknown',
            branch: current.branch || 'detached',
            isBare: Boolean(current.isBare),
            isLocked: Boolean(current.isLocked),
            isCurrent: normPath === normCwd,
          });
        }
        current = {};
        continue;
      }

      if (trimmed.startsWith('worktree ')) {
        current.path = trimmed.slice(9).trim();
      } else if (trimmed.startsWith('HEAD ')) {
        current.head = trimmed.slice(5).trim();
      } else if (trimmed.startsWith('branch ')) {
        current.branch = trimmed.slice(7).replace('refs/heads/', '').trim();
      } else if (trimmed === 'bare') {
        current.isBare = true;
      } else if (trimmed.startsWith('locked')) {
        current.isLocked = true;
      } else if (trimmed === 'detached') {
        current.branch = 'HEAD (detached)';
      }
    }

    if (current.path) {
      const normPath = path.resolve(current.path).toLowerCase().replace(/\\/g, '/');
      worktrees.push({
        path: current.path,
        relativePath: path.relative(this.baseDir, current.path).replace(/\\/g, '/') || '.',
        head: current.head || 'unknown',
        branch: current.branch || 'detached',
        isBare: Boolean(current.isBare),
        isLocked: Boolean(current.isLocked),
        isCurrent: normPath === normCwd,
      });
    }

    return { total: worktrees.length, worktrees };
  }

  public async getSyncStatus(customCwd?: string, project?: string): Promise<GitSyncStatus> {
    const cwd = this.resolveCwd(customCwd, project);
    const tracking = await getGitTrackingStatus(cwd, { maxUnpushedCommits: 10 });
    const branch = tracking.branch || 'HEAD';
    const upstream = tracking.upstream;
    const ahead = tracking.ahead;
    const behind = tracking.behind;
    const unpushedCommits = tracking.unpushedCommits;
    const divergence: GitSyncStatus['divergence'] = tracking.divergence;

    const statusRes = await this.processService.runCommand({ command: 'git status --porcelain', cwd, projectName: project });
    const isClean = !statusRes.stdout.trim();
    const { fingerprint } = await this.getWorkspaceFingerprint(customCwd, project);

    return {
      branch,
      upstream,
      ahead,
      behind,
      isClean,
      unpushedCommits,
      divergence,
      fingerprint,
    };
  }

  public async compareBranches(
    baseBranch: string,
    targetBranch: string = 'HEAD',
    customCwd?: string,
    project?: string
  ): Promise<BranchComparison> {
    const cwd = this.resolveCwd(customCwd, project);

    const baseClean = baseBranch.trim().replace(/^refs\/heads\//, '');
    const targetClean = targetBranch.trim().replace(/^refs\/heads\//, '');

    const mergeBaseRes = await this.processService.runCommand({
      command: `git merge-base ${baseClean} ${targetClean}`,
      cwd,
      projectName: project,
    });
    if (mergeBaseRes.exitCode !== 0) {
      throw new Error(`Failed to calculate merge-base between "${baseClean}" and "${targetClean}": ${mergeBaseRes.stderr}`);
    }
    const mergeBase = mergeBaseRes.stdout.trim();

    const countRes = await this.processService.runCommand({
      command: `git rev-list --count --left-right ${baseClean}...${targetClean}`,
      cwd,
      projectName: project,
    });
    const parts = countRes.stdout.trim().split(/\s+/);
    const behindCount = parseInt(parts[0], 10) || 0;
    const aheadCount = parseInt(parts[1], 10) || 0;

    const commitsRes = await this.processService.runCommand({
      command: `git log ${baseClean}..${targetClean} --oneline -n 30`,
      cwd,
      projectName: project,
    });
    const commits: Array<{ hash: string; message: string }> = [];
    if (commitsRes.exitCode === 0 && commitsRes.stdout.trim()) {
      for (const line of commitsRes.stdout.split(/\r?\n/).filter(Boolean)) {
        const firstSpace = line.indexOf(' ');
        if (firstSpace > 0) {
          commits.push({
            hash: line.slice(0, firstSpace),
            message: line.slice(firstSpace + 1),
          });
        }
      }
    }

    const diffStatRes = await this.processService.runCommand({
      command: `git diff --stat ${baseClean}...${targetClean}`,
      cwd,
      projectName: project,
    });
    const diffSummary = diffStatRes.stdout.trim();
    const filesChangedCount = diffSummary ? diffSummary.split(/\r?\n/).length - 1 : 0;

    return {
      baseBranch: baseClean,
      targetBranch: targetClean,
      mergeBase,
      aheadCount,
      behindCount,
      commits,
      filesChangedCount: Math.max(0, filesChangedCount),
      diffSummary,
    };
  }

  public async closeFeatureBranch(options: {
    branchName: string;
    targetBranch?: string;
    verificationCommand?: string;
    deleteRemote?: boolean;
    customCwd?: string;
    project?: string;
  }): Promise<{
    success: boolean;
    branchClosed: string;
    targetBranch: string;
    stepsCompleted: string[];
    verificationPassed: boolean;
    message: string;
  }> {
    const cwd = this.resolveCwd(options.customCwd, options.project);
    const branchToClose = options.branchName.trim().replace(/^refs\/heads\//, '');
    const target = (options.targetBranch || 'main').trim().replace(/^refs\/heads\//, '');
    const stepsCompleted: string[] = [];

    // 1. Check if workspace is clean
    const statusRes = await this.processService.runCommand({ command: 'git status --porcelain', cwd, projectName: options.project });
    if (statusRes.stdout.trim()) {
      throw new Error(`Cannot close branch: Working tree has uncommitted or dirty files. Commit or stash first.`);
    }
    stepsCompleted.push('Working tree clean verification');

    // 2. Pre-merge Verification (if command provided)
    if (options.verificationCommand) {
      const preTest = await this.processService.runCommand({ command: options.verificationCommand, cwd, projectName: options.project });
      if (preTest.exitCode !== 0) {
        throw new Error(
          `Pre-merge verification failed on branch "${branchToClose}": ${preTest.stderr || preTest.stdout}. Aborting close.`
        );
      }
      stepsCompleted.push(`Pre-merge verification passed: "${options.verificationCommand}"`);
    }

    // 3. Checkout target branch
    const checkoutRes = await this.processService.runCommand({ command: `git checkout ${target}`, cwd, projectName: options.project });
    if (checkoutRes.exitCode !== 0) {
      throw new Error(`Failed to checkout target branch "${target}": ${checkoutRes.stderr}`);
    }
    stepsCompleted.push(`Switched to target branch: "${target}"`);

    // 4. Merge feature branch
    const mergeRes = await this.processService.runCommand({ command: `git merge --no-ff ${branchToClose}`, cwd, projectName: options.project });
    if (mergeRes.exitCode !== 0) {
      // Abort merge if conflict
      await this.processService.runCommand({ command: 'git merge --abort', cwd, projectName: options.project });
      // Switch back
      await this.processService.runCommand({ command: `git checkout ${branchToClose}`, cwd, projectName: options.project });
      throw new Error(
        `Merge conflict occurred while merging "${branchToClose}" into "${target}". Merge aborted and returned to original branch.`
      );
    }
    stepsCompleted.push(`Merged branch "${branchToClose}" into "${target}"`);

    // 5. Post-merge Verification
    if (options.verificationCommand) {
      const postTest = await this.processService.runCommand({ command: options.verificationCommand, cwd, projectName: options.project });
      if (postTest.exitCode !== 0) {
        // Rollback merge
        await this.processService.runCommand({ command: 'git reset --hard HEAD~1', cwd, projectName: options.project });
        await this.processService.runCommand({ command: `git checkout ${branchToClose}`, cwd, projectName: options.project });
        throw new Error(
          `Post-merge verification failed on "${target}": ${postTest.stderr || postTest.stdout}. Rollback executed.`
        );
      }
      stepsCompleted.push(`Post-merge verification passed on "${target}"`);
    }

    // 6. Delete local branch
    const deleteBranchRes = await this.processService.runCommand({ command: `git branch -d ${branchToClose}`, cwd, projectName: options.project });
    if (deleteBranchRes.exitCode === 0) {
      stepsCompleted.push(`Deleted local branch: "${branchToClose}"`);
    } else {
      stepsCompleted.push(`Local branch delete note: ${deleteBranchRes.stderr.trim()}`);
    }

    // 7. Delete remote branch (if requested)
    if (options.deleteRemote) {
      const deleteRemoteRes = await this.processService.runCommand({
        command: `git push origin --delete ${branchToClose}`,
        cwd,
        projectName: options.project,
      });
      if (deleteRemoteRes.exitCode === 0) {
        stepsCompleted.push(`Deleted remote branch "origin/${branchToClose}"`);
      }
    }

      return {
        success: true,
        branchClosed: branchToClose,
        targetBranch: target,
        stepsCompleted,
        verificationPassed: Boolean(options.verificationCommand),
        message: `Successfully merged and closed feature branch "${branchToClose}" into "${target}".`,
      };
    }

  public async getBranchDetails(customCwd?: string, project?: string): Promise<{
    currentBranch: string;
    upstreamBranch?: string;
    ahead: number;
    behind: number;
    branches: Array<{ name: string; isCurrent: boolean; isRemote: boolean; commitHash: string; commitMessage: string }>;
  }> {
    const cwd = this.resolveCwd(customCwd, project);
    const syncStatus = await this.getSyncStatus(customCwd, project);

    const branchRes = await this.processService.runCommand({ command: 'git branch -a -v --no-abbrev', cwd, projectName: project });
    const branches: Array<{ name: string; isCurrent: boolean; isRemote: boolean; commitHash: string; commitMessage: string }> = [];

    if (branchRes.exitCode === 0) {
      const lines = branchRes.stdout.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const isCurrent = line.startsWith('*');
        const clean = line.replace(/^\*?\s+/, '');
        const parts = clean.split(/\s+/);
        if (parts.length >= 2) {
          const name = parts[0];
          const isRemote = name.startsWith('remotes/');
          const commitHash = parts[1] || '';
          const commitMessage = parts.slice(2).join(' ') || '';
          branches.push({
            name: name.replace('remotes/origin/', '').replace('remotes/', ''),
            isCurrent,
            isRemote,
            commitHash: commitHash.slice(0, 10),
            commitMessage,
          });
        }
      }
    }

    if (branches.length === 0 && syncStatus.branch !== 'HEAD') {
      branches.push({
        name: syncStatus.branch,
        isCurrent: true,
        isRemote: false,
        commitHash: 'unborn',
        commitMessage: 'No commits yet',
      });
    }

    return {
      currentBranch: syncStatus.branch,
      upstreamBranch: syncStatus.upstream,
      ahead: syncStatus.ahead,
      behind: syncStatus.behind,
      branches,
    };
  }

  public async pushBranch(options?: {
    branch?: string;
    remote?: string;
    setUpstream?: boolean;
    force?: boolean;
    dryRun?: boolean;
    customCwd?: string;
    project?: string;
  }): Promise<{
    success: boolean;
    branch: string;
    remote: string;
    stdout: string;
    stderr: string;
    pushedCommitsCount: number;
  }> {
    const cwd = this.resolveCwd(options?.customCwd, options?.project);
    const syncStatus = await this.getSyncStatus(options?.customCwd, options?.project);
    const targetBranch = options?.branch || syncStatus.branch;
    const remote = options?.remote || 'origin';

    const args: string[] = ['git', 'push'];
    if (options?.dryRun) args.push('--dry-run');
    if (options?.force) args.push('--force-with-lease');
    if (options?.setUpstream || !syncStatus.upstream) args.push('-u');
    args.push(remote, targetBranch);

    const cmd = args.join(' ');
    const res = await this.processService.runCommand({ command: cmd, cwd, projectName: options?.project });

    if (res.exitCode !== 0) {
      throw new Error(`Git push failed: ${res.stderr || res.stdout}`);
    }

    return {
      success: true,
      branch: targetBranch,
      remote,
      stdout: res.stdout,
      stderr: res.stderr,
      pushedCommitsCount: syncStatus.ahead,
    };
  }
}
