import { ProcessService } from '../services/processService.js';
import { getGitTrackingStatus } from './trackingStatus.js';

export interface GitSyncStatusResult {
  local: {
    branch: string | null;
    head: string;
    headShort: string;
  };
  upstream?: {
    ref: string;
    ahead: number;
    behind: number;
  };
  main?: {
    aheadOfMain?: number;
    behindMain?: number;
  };
  dirty: boolean;
  remoteChangesAvailable: boolean;
}

export async function getGitSyncStatus(
  proc: ProcessService,
  cwd: string,
  options?: { fetch?: boolean }
): Promise<GitSyncStatusResult> {
  if (options?.fetch) {
    await proc.runCommand({ command: 'git fetch --prune', cwd });
  }

  // Branch
  let branch: string | null = null;
  const branchRes = await proc.runCommand({ command: 'git branch --show-current', cwd });
  if (branchRes.exitCode === 0 && branchRes.stdout.trim()) {
    branch = branchRes.stdout.trim();
  }

  // HEAD
  let head = 'unknown';
  let headShort = 'unknown';
  const headRes = await proc.runCommand({ command: 'git rev-parse HEAD', cwd });
  if (headRes.exitCode === 0 && headRes.stdout.trim()) {
    head = headRes.stdout.trim();
    headShort = head.slice(0, 7);
  }

  // Upstream
  const tracking = await getGitTrackingStatus(cwd);
  const upstream: GitSyncStatusResult['upstream'] | undefined = tracking.upstream
    ? { ref: tracking.upstream, ahead: tracking.ahead, behind: tracking.behind }
    : undefined;

  // Main branch diff
  let mainDiff: GitSyncStatusResult['main'] | undefined;
  const mainCountRes = await proc.runCommand({ command: 'git rev-list --left-right --count HEAD...main', cwd });
  if (mainCountRes.exitCode === 0) {
    const parts = mainCountRes.stdout.trim().split(/\s+/);
    mainDiff = {
      aheadOfMain: parseInt(parts[0], 10) || 0,
      behindMain: parseInt(parts[1], 10) || 0,
    };
  }

  // Dirty
  const statusRes = await proc.runCommand({ command: 'git status --porcelain', cwd });
  const dirty = statusRes.stdout.trim().length > 0;

  return {
    local: { branch, head, headShort },
    upstream,
    main: mainDiff,
    dirty,
    remoteChangesAvailable: (upstream?.behind ?? 0) > 0,
  };
}
