import { ProcessService } from '../services/processService.js';

export interface CloseFeatureBranchOptions {
  branch: string;
  target?: string;
  strategy?: 'merge' | 'squash' | 'rebase';
  verificationCommand?: string;
  deleteLocal?: boolean;
  deleteRemote?: boolean;
  dryRun?: boolean;
}

export interface CloseFeatureBranchResult {
  success: boolean;
  strategy: string;
  mergedBranch: string;
  targetBranch: string;
  verificationPassed: boolean;
  deletedLocalBranch?: boolean;
  deletedRemoteBranch?: boolean;
  message: string;
}

export async function closeFeatureBranch(
  proc: ProcessService,
  cwd: string,
  options: CloseFeatureBranchOptions
): Promise<CloseFeatureBranchResult> {
  const branch = options.branch;
  const target = options.target || 'main';
  const strategy = options.strategy || 'merge';

  // Step 1: Precondition - Workspace must be clean
  const statusRes = await proc.runCommand({ command: 'git status --porcelain', cwd });
  if (statusRes.stdout.trim().length > 0) {
    const err: any = new Error(
      `[DIRTY_WORKTREE] Working directory contains uncommitted changes. Please commit or stash before closing branch.`
    );
    err.category = 'conflict';
    err.code = 'DIRTY_WORKTREE';
    throw err;
  }

  // Step 2: Verification command check if specified
  if (options.verificationCommand) {
    const verifyRes = await proc.runCommand({ command: options.verificationCommand, cwd });
    if (verifyRes.exitCode !== 0) {
      const err: any = new Error(
        `[COMMAND_FAILED] Pre-merge verification command failed (${options.verificationCommand}). Aborting branch merge.`
      );
      err.category = 'execution';
      err.code = 'COMMAND_FAILED';
      throw err;
    }
  }

  if (options.dryRun) {
    return {
      success: true,
      strategy,
      mergedBranch: branch,
      targetBranch: target,
      verificationPassed: true,
      message: `[DRY_RUN] Branch "${branch}" is verified and ready to be merged into "${target}".`,
    };
  }

  // Step 3: Checkout target
  const checkoutRes = await proc.runCommand({ command: `git checkout ${target}`, cwd });
  if (checkoutRes.exitCode !== 0) {
    throw new Error(`Failed to checkout target branch "${target}": ${checkoutRes.stderr}`);
  }

  // Capture exact target HEAD before merge so rollback never guesses with HEAD~1.
  const preMergeHeadRes = await proc.runCommand({ command: 'git rev-parse HEAD', cwd });
  if (preMergeHeadRes.exitCode !== 0) {
    throw new Error(`Failed to capture pre-merge HEAD: ${preMergeHeadRes.stderr || preMergeHeadRes.stdout}`);
  }
  const preMergeHead = preMergeHeadRes.stdout.trim();

  // Step 4: Merge
  const mergeCmd = strategy === 'squash' ? `git merge --squash ${branch}` : `git merge ${branch} --no-ff -m "Merge branch '${branch}'"`;
  const mergeRes = await proc.runCommand({ command: mergeCmd, cwd });

  if (mergeRes.exitCode !== 0) {
    // Abort merge on conflict
    await proc.runCommand({ command: 'git merge --abort', cwd }).catch(() => {});
    const err: any = new Error(`[GIT_CONFLICT] Merge conflict merging "${branch}" into "${target}". Merge was aborted.`);
    err.category = 'conflict';
    err.code = 'GIT_CONFLICT';
    throw err;
  }

  if (strategy === 'squash') {
    await proc.runCommand({ command: `git commit -m "Squash merge branch '${branch}'"`, cwd });
  }

  // Step 5: Post-merge verification check
  if (options.verificationCommand) {
    const postVerify = await proc.runCommand({ command: options.verificationCommand, cwd });
    if (postVerify.exitCode !== 0) {
      // Roll back to the exact pre-merge target commit captured above.
      await proc.runCommand({ command: `git reset --hard ${preMergeHead}`, cwd });
      throw new Error(`Post-merge verification failed. Rolled back merge to ${preMergeHead}.`);
    }
  }

  // Step 6: Delete local branch
  let deletedLocal = false;
  if (options.deleteLocal !== false) {
    const delRes = await proc.runCommand({ command: `git branch -d ${branch}`, cwd });
    deletedLocal = delRes.exitCode === 0;
  }

  // Step 7: Delete remote branch if requested
  let deletedRemote = false;
  if (options.deleteRemote) {
    const delRemoteRes = await proc.runCommand({ command: `git push origin --delete ${branch}`, cwd });
    deletedRemote = delRemoteRes.exitCode === 0;
  }

  return {
    success: true,
    strategy,
    mergedBranch: branch,
    targetBranch: target,
    verificationPassed: true,
    deletedLocalBranch: deletedLocal,
    deletedRemoteBranch: deletedRemote,
    message: `Successfully merged and closed feature branch "${branch}" into "${target}".`,
  };
}
