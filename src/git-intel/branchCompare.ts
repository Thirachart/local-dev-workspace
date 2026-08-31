import { ProcessService } from '../services/processService.js';

export interface BranchComparisonResult {
  base: string;
  head: string;
  mergeBase: string;
  ahead: number;
  behind: number;
  baseContainsHead: boolean;
  headContainsBase: boolean;
  changedFiles: Array<{ path: string; status: string }>;
  commitsOnlyInHead: Array<{ hash: string; subject: string; author: string; date: string }>;
}

export async function compareGitBranches(
  proc: ProcessService,
  cwd: string,
  base: string,
  head: string
): Promise<BranchComparisonResult> {
  // 1. Merge Base
  const mbRes = await proc.runCommand({ command: `git merge-base ${base} ${head}`, cwd });
  const mergeBase = mbRes.exitCode === 0 ? mbRes.stdout.trim() : 'unknown';

  // 2. Ahead / Behind
  let ahead = 0;
  let behind = 0;
  const countRes = await proc.runCommand({ command: `git rev-list --left-right --count ${base}...${head}`, cwd });
  if (countRes.exitCode === 0) {
    const parts = countRes.stdout.trim().split(/\s+/);
    behind = parseInt(parts[0], 10) || 0;
    ahead = parseInt(parts[1], 10) || 0;
  }

  // 3. Changed Files
  const changedFiles: BranchComparisonResult['changedFiles'] = [];
  const diffRes = await proc.runCommand({ command: `git diff --name-status ${base}...${head}`, cwd });
  if (diffRes.exitCode === 0) {
    const lines = diffRes.stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/\t+/);
      if (parts.length >= 2) {
        changedFiles.push({ status: parts[0], path: parts[1] });
      }
    }
  }

  // 4. Commits Only in Head
  const commitsOnlyInHead: BranchComparisonResult['commitsOnlyInHead'] = [];
  const logRes = await proc.runCommand({
    command: `git log --pretty=format:"%h|%s|%an|%ad" ${base}..${head}`,
    cwd,
  });
  if (logRes.exitCode === 0 && logRes.stdout.trim()) {
    const lines = logRes.stdout.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const [h, s, a, d] = line.split('|');
      commitsOnlyInHead.push({ hash: h, subject: s, author: a, date: d });
    }
  }

  return {
    base,
    head,
    mergeBase,
    ahead,
    behind,
    baseContainsHead: ahead === 0,
    headContainsBase: behind === 0,
    changedFiles,
    commitsOnlyInHead,
  };
}
