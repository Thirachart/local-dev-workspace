import { ProcessService } from '../services/processService.js';
import { ToolWarning } from '../core/types.js';

export interface WorktreeSummary {
  path: string;
  head: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  dirty?: boolean;
}

export interface ListWorktreesResult {
  worktrees: WorktreeSummary[];
  warnings?: ToolWarning[];
}

export async function listGitWorktrees(
  proc: ProcessService,
  cwd: string,
  options?: { includeStatus?: boolean }
): Promise<ListWorktreesResult> {
  const warnings: ToolWarning[] = [];
  const res = await proc.runCommand({ command: 'git worktree list --porcelain', cwd });

  if (res.exitCode !== 0) {
    return { worktrees: [], warnings };
  }

  const worktrees: WorktreeSummary[] = [];
  const blocks = res.stdout.split(/\r?\n\r?\n/).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    let wtPath = '';
    let head = '';
    let branch = '';
    let bare = false;
    let detached = false;
    let locked = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) wtPath = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) head = line.slice(5).trim();
      else if (line.startsWith('branch ')) branch = line.slice(7).replace('refs/heads/', '').trim();
      else if (line === 'bare') bare = true;
      else if (line === 'detached') detached = true;
      else if (line === 'locked') locked = true;
    }

    if (wtPath) {
      let dirty: boolean | undefined;
      if (options?.includeStatus && !bare) {
        const statRes = await proc.runCommand({ command: 'git status --porcelain', cwd: wtPath });
        dirty = statRes.stdout.trim().length > 0;
      }

      worktrees.push({
        path: wtPath,
        head,
        branch: branch || undefined,
        bare,
        detached,
        locked,
        dirty,
      });
    }
  }

  // Detect concurrent worktree activity (multiple worktrees on the same or related branches)
  const activeBranches = worktrees.filter(w => w.branch && !w.bare).map(w => w.branch);
  const duplicates = activeBranches.filter((b, idx) => activeBranches.indexOf(b) !== idx);
  if (duplicates.length > 0) {
    warnings.push({
      code: 'CONCURRENT_WORKTREE_ACTIVITY',
      message: `Multiple worktrees are currently attached to branch: ${duplicates.join(', ')}`,
    });
  }

  return { worktrees, warnings };
}
