import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { ProcessService } from '../services/processService.js';
import { ProjectService } from '../services/projectService.js';
import { WorkspaceObservation } from './types.js';

export class SnapshotManager {
  constructor(
    private processService: ProcessService,
    private baseDir: string,
    private projectService?: ProjectService
  ) {}

  public async getObservationToken(customCwd?: string, project?: string): Promise<WorkspaceObservation> {
    let cwd = this.baseDir;
    let projectName = project || 'default';

    if (this.projectService) {
      const verifiedProject = this.projectService.getRequiredProject(project || '');
      projectName = verifiedProject.name;
      cwd = this.projectService.resolveWorkingDir(customCwd, projectName);
    } else if (customCwd) {
      cwd = path.resolve(this.baseDir, customCwd);
    }

    let branch: string | null = null;
    let head = 'unknown';
    let headShort = 'unknown';
    let indexTree = 'empty-index';

    // 1. Branch / Ref Identity
    const branchRes = await this.processService.runCommand({ command: 'git branch --show-current', cwd, projectName });
    if (branchRes.exitCode === 0 && branchRes.stdout.trim()) {
      branch = branchRes.stdout.trim();
    } else {
      // Detached HEAD ref or symbolic ref fallback
      const symbolicRes = await this.processService.runCommand({ command: 'git symbolic-ref -q --short HEAD', cwd, projectName });
      if (symbolicRes.exitCode === 0 && symbolicRes.stdout.trim()) {
        branch = symbolicRes.stdout.trim();
      }
    }

    // 2. HEAD commit
    const headRes = await this.processService.runCommand({ command: 'git rev-parse HEAD', cwd, projectName });
    if (headRes.exitCode === 0 && headRes.stdout.trim()) {
      head = headRes.stdout.trim();
      headShort = head.slice(0, 7);
    }

    // 3. Index Object / Blob Fingerprint (captures exact staged index blob objects)
    const stageRes = await this.processService.runCommand({ command: 'git ls-files --stage', cwd, projectName });
    if (stageRes.exitCode === 0 && stageRes.stdout.trim()) {
      indexTree = crypto.createHash('sha256').update(stageRes.stdout.trim()).digest('hex').slice(0, 20);
    } else {
      const writeTreeRes = await this.processService.runCommand({ command: 'git write-tree', cwd, projectName });
      if (writeTreeRes.exitCode === 0 && writeTreeRes.stdout.trim()) {
        indexTree = writeTreeRes.stdout.trim();
      }
    }

    // 4. Git Status using NUL-delimited format (-z)
    const statusRes = await this.processService.runCommand({ command: 'git status --porcelain=v1 -z', cwd, projectName });
    const rawStatus = statusRes.stdout;

    let stagedCount = 0;
    let modifiedCount = 0;
    let untrackedCount = 0;
    const untrackedAndDirtyHashes: Record<string, string> = {};

    const validGitStatusChars = new Set(['M', 'A', 'D', 'R', 'C', 'U', '?']);

    if (rawStatus.trim().length > 0) {
      const rawEntries = rawStatus.includes('\0')
        ? rawStatus.split('\0')
        : rawStatus.split(/\r?\n/);
      const entries = rawEntries.filter(e => e && e.length >= 3);

      let i = 0;
      while (i < entries.length) {
        const entry = entries[i];
        const x = entry[0];
        const y = entry[1];
        const filePath = entry.slice(2).trim().replace(/^"|"$/g, '');

        if (x !== ' ' && x !== '?' && validGitStatusChars.has(x)) stagedCount++;
        if ((y === 'M' || y === 'D') && validGitStatusChars.has(y)) modifiedCount++;
        if (x === '?' && y === '?') untrackedCount++;

        // In case of rename (R), git -z puts the new path in the next entry
        if ((x === 'R' || y === 'R') && rawStatus.includes('\0')) {
          i++; // Skip the target rename path
        }

        const fullPath = path.resolve(cwd, filePath);
        if (fsSync.existsSync(fullPath)) {
          try {
            const stat = await fs.stat(fullPath);
            if (stat.isFile()) {
              const content = await fs.readFile(fullPath);
              untrackedAndDirtyHashes[filePath] = crypto
                .createHash('sha256')
                .update(content)
                .digest('hex')
                .slice(0, 16);
            }
          } catch {}
        }
        i++;
      }
    }

    // 5. Dynamic Effective Instruction Files Discovery
    const effectiveInstructionFiles = await this.discoverEffectiveInstructionFiles(cwd);
    let combinedInstructions = '';
    for (const ruleFile of effectiveInstructionFiles) {
      const fullPath = path.resolve(cwd, ruleFile);
      if (fsSync.existsSync(fullPath)) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          combinedInstructions += `${ruleFile}:${content}\n`;
        } catch {}
      }
    }
    const instructionsCombinedHash = crypto
      .createHash('sha256')
      .update(combinedInstructions)
      .digest('hex')
      .slice(0, 16);

    // 6. Deterministic Fingerprint Calculation
    const dirtyFingerprint = Object.entries(untrackedAndDirtyHashes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(';');

    const rawFingerprint = [
      `proj=${projectName}`,
      `branch=${branch || 'none'}`,
      `head=${head}`,
      `index=${indexTree}`,
      `dirty=${dirtyFingerprint}`,
      `inst=${instructionsCombinedHash}`,
    ].join('|');

    const snapshotId = `snap_${crypto.createHash('sha256').update(rawFingerprint).digest('hex').slice(0, 16)}`;

    return {
      snapshotId,
      projectId: projectName,
      git: {
        branch,
        head,
        headShort,
        indexTree,
        dirty: stagedCount > 0 || modifiedCount > 0 || untrackedCount > 0,
        stagedCount,
        modifiedCount,
        untrackedCount,
        untrackedAndDirtyHashes,
      },
      instructionsCombinedHash,
    };
  }

  public async validateSnapshot(expectedSnapshotId: string, customCwd?: string, project?: string): Promise<boolean> {
    const current = await this.getObservationToken(customCwd, project);
    return current.snapshotId === expectedSnapshotId;
  }

  private async discoverEffectiveInstructionFiles(cwd: string): Promise<string[]> {
    const defaultCandidates = [
      'CLAUDE.md',
      'AGENTS.md',
      'CONTEXT.md',
      '.cursorrules',
      '.chat-dev/handoff.md',
      '.chat-dev/rules.md',
    ];

    const discovered: string[] = [];
    for (const candidate of defaultCandidates) {
      if (fsSync.existsSync(path.resolve(cwd, candidate))) {
        discovered.push(candidate);
      }
    }
    return discovered;
  }
}
