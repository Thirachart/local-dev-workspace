import crypto from 'node:crypto';
import type { ProcessService } from '../services/processService.js';

export interface GitObservation {
  observationId: string;
  head: string;
  branch: string | null;
  indexFingerprint: string;
}

export async function getGitObservation(proc: ProcessService, cwd: string, projectName?: string): Promise<GitObservation> {
  const [headRes, branchRes, indexRes] = await Promise.all([
    proc.runCommand({ command: 'git rev-parse HEAD', cwd, projectName }),
    proc.runCommand({ command: 'git branch --show-current', cwd, projectName }),
    proc.runCommand({ command: 'git diff --cached --raw --no-abbrev -z', cwd, projectName }),
  ]);

  if (headRes.exitCode !== 0) {
    const err: any = new Error(`[COMMAND_FAILED] Unable to read Git HEAD: ${headRes.stderr || headRes.stdout}`);
    err.category = 'execution';
    err.code = 'COMMAND_FAILED';
    throw err;
  }

  const head = headRes.stdout.trim();
  const branch = branchRes.exitCode === 0 && branchRes.stdout.trim() ? branchRes.stdout.trim() : null;
  const indexFingerprint = crypto.createHash('sha256').update(indexRes.stdout).digest('hex');
  const observationId = `git_${crypto.createHash('sha256').update(`${branch ?? 'DETACHED'}\0${head}\0${indexFingerprint}`).digest('hex')}`;

  return { observationId, head, branch, indexFingerprint };
}

export async function assertGitObservation(
  proc: ProcessService,
  cwd: string,
  expectedObservationId?: string,
  projectName?: string
): Promise<GitObservation> {
  const observation = await getGitObservation(proc, cwd, projectName);
  if (expectedObservationId && observation.observationId !== expectedObservationId) {
    const err: any = new Error(
      `[STALE_GIT_OBSERVATION] Git state changed. Expected "${expectedObservationId}" but found "${observation.observationId}".`
    );
    err.category = 'conflict';
    err.code = 'STALE_GIT_OBSERVATION';
    err.details = { expectedObservationId, currentObservationId: observation.observationId };
    throw err;
  }
  return observation;
}
