import { execFile } from 'node:child_process';
import util from 'node:util';

const execFileAsync = util.promisify(execFile);

export type GitDivergence = 'up-to-date' | 'ahead' | 'behind' | 'diverged' | 'no-upstream';

export interface GitTrackingStatus {
  branch: string | null;
  upstream?: string;
  ahead: number;
  behind: number;
  unpushedCommits: string[];
  divergence: GitDivergence;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

/**
 * Resolve branch tracking state without going through a shell.
 *
 * This intentionally uses execFile + argument arrays because revision syntax
 * such as @{upstream} is parsed specially by PowerShell when embedded in a
 * command string. Using git for-each-ref also lets us detect an absent
 * upstream cleanly without treating shell parsing failures as "no upstream".
 */
export async function getGitTrackingStatus(
  cwd: string,
  options?: { maxUnpushedCommits?: number }
): Promise<GitTrackingStatus> {
  let branch: string | null = null;

  try {
    const current = await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    branch = current || null;
  } catch {
    // Detached HEAD (or unborn/non-standard state): there is no local branch
    // whose configured upstream can be inspected.
    branch = null;
  }

  if (!branch) {
    return {
      branch,
      ahead: 0,
      behind: 0,
      unpushedCommits: [],
      divergence: 'no-upstream',
    };
  }

  let upstream: string | undefined;
  try {
    const configured = await runGit(cwd, [
      'for-each-ref',
      '--format=%(upstream:short)',
      `refs/heads/${branch}`,
    ]);
    upstream = configured || undefined;
  } catch {
    upstream = undefined;
  }

  if (!upstream) {
    return {
      branch,
      ahead: 0,
      behind: 0,
      unpushedCommits: [],
      divergence: 'no-upstream',
    };
  }

  let ahead = 0;
  let behind = 0;

  try {
    const counts = await runGit(cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]);
    const [left, right] = counts.split(/\s+/);
    behind = Number.parseInt(left || '0', 10) || 0;
    ahead = Number.parseInt(right || '0', 10) || 0;
  } catch {
    // The branch is configured to track an upstream, but the upstream ref is
    // not currently resolvable (for example after a remote branch was deleted).
    // Preserve the configured upstream name while avoiding fabricated counts.
    return {
      branch,
      upstream,
      ahead: 0,
      behind: 0,
      unpushedCommits: [],
      divergence: 'no-upstream',
    };
  }

  let divergence: GitDivergence;
  if (ahead === 0 && behind === 0) {
    divergence = 'up-to-date';
  } else if (ahead > 0 && behind === 0) {
    divergence = 'ahead';
  } else if (ahead === 0 && behind > 0) {
    divergence = 'behind';
  } else {
    divergence = 'diverged';
  }

  let unpushedCommits: string[] = [];
  if (ahead > 0) {
    const maxUnpushed = Math.max(1, options?.maxUnpushedCommits ?? 10);
    try {
      const log = await runGit(cwd, ['log', `${upstream}..HEAD`, '--oneline', '-n', String(maxUnpushed)]);
      unpushedCommits = log ? log.split(/\r?\n/).filter(Boolean) : [];
    } catch {
      unpushedCommits = [];
    }
  }

  return {
    branch,
    upstream,
    ahead,
    behind,
    unpushedCommits,
    divergence,
  };
}
