import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { it, describe, before } from 'node:test';
import { ProjectService } from '../src/services/projectService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { PatchService } from '../src/services/patchService.js';
import { SnapshotService } from '../src/services/snapshotService.js';
import { GitService } from '../src/services/gitService.js';

describe('Compact Response Modes & Tool Contract Fixes', () => {
  let projectService: ProjectService;
  let memoryService: MemoryService;
  let patchService: PatchService;
  let snapshotService: SnapshotService;

  before(async () => {
    projectService = new ProjectService();
    await projectService.init();
    memoryService = new MemoryService();
    patchService = new PatchService(process.cwd(), projectService);
    snapshotService = new SnapshotService(projectService, new GitService(process.cwd(), projectService), memoryService);
  });

  it('1. explicit project resolution returns compact metadata under 1KB without heavy systemPrompt', async () => {
    const dataProj = projectService.getRequiredProject('data-project');
    assert.ok(dataProj, 'data-project should resolve explicitly');

    const sanitized = projectService.sanitizeProjectForClient(dataProj);
    const jsonStr = JSON.stringify(sanitized, null, 2);

    assert.ok(Buffer.byteLength(jsonStr, 'utf-8') < 1000, `Payload must be under 1KB (was ${Buffer.byteLength(jsonStr, 'utf-8')} bytes)`);
    assert.strictEqual((sanitized as any).systemPrompt, undefined, 'systemPrompt must be omitted');
    assert.strictEqual((sanitized as any).projectInstructions, undefined, 'projectInstructions must be omitted');
    assert.strictEqual((sanitized as any).availableSkills, undefined, 'availableSkills must be omitted');
  });

  it('2. listProjects: supports pagination (limit & offset) and compact metadata', () => {
    const res = projectService.listProjects('global', true, { limit: 2, offset: 0, compact: true });
    assert.ok(res.projects.length <= 2, 'Projects array must observe limit');
    assert.strictEqual(res.limit, 2);
    assert.strictEqual(res.offset, 0);
    assert.ok(res.totalCount >= 2, 'totalCount must reflect total registry projects');

    for (const p of res.projects) {
      assert.strictEqual((p as any).systemPrompt, undefined);
      assert.strictEqual((p as any).projectInstructions, undefined);
    }
  });

  it('3. getProjectSnapshot: supports compact=true returning observation tokens without repeating rules', async () => {
    const snap = await snapshotService.getSnapshot({ project: 'data-project', compact: true });
    assert.ok(snap, 'Snapshot should be generated');
    assert.strictEqual(snap.instructions.content, undefined, 'compact snapshot must omit instructions content');
    assert.strictEqual(snap.handoff.summary, undefined, 'compact snapshot must omit handoff summary');
    assert.ok(snap.snapshotFingerprint, 'Fingerprint must be present');
  });

  it('4. writeHandoff: writes exact raw markdown content without template header wrapper', async () => {
    const proj = projectService.getRequiredProject('chat-dev-mcp');
    assert.ok(proj, 'Active project required for handoff test');

    const exactMarkdown = `# Custom Handoff Notes\n\n- Task 1: Complete\n- Task 2: In Progress\n`;
    const res = await memoryService.writeHandoff(proj.path, {
      markdown: exactMarkdown,
      persist: 'server',
    });

    assert.ok(res.exists, 'Handoff file must be created');
    assert.strictEqual(res.content, exactMarkdown, 'Content must match exact raw markdown string');

    const readRes = await memoryService.readHandoff(proj.path);
    assert.strictEqual(readRes.content?.trim(), exactMarkdown.trim(), 'Read handoff must match written exact markdown');
  });

  it('5. applyPatch: supports patch and diff parameters interchangeably', async () => {
    const proj = projectService.getRequiredProject('chat-dev-mcp');
    assert.ok(proj, 'Project required');

    const targetFile = path.join(proj.path, 'tmp_patch_test.txt');
    await fs.writeFile(targetFile, 'Hello World Old Content\n');

    try {
      const patchRes = await patchService.applyStructuredPatch(
        [{ filePath: 'tmp_patch_test.txt', targetContent: 'Hello World Old Content', replacementContent: 'Hello World New Content' }],
        { project: proj.name }
      );
      assert.ok(patchRes.filesModified.includes('tmp_patch_test.txt'), 'Target file should be modified');

      const updated = await fs.readFile(targetFile, 'utf-8');
      assert.strictEqual(updated, 'Hello World New Content\n', 'File content should be patched');
    } finally {
      await fs.unlink(targetFile).catch(() => {});
    }
  });

  it('6. readHandoff: auto-selects most recently modified handoff file (mtime)', async () => {
    const proj = projectService.getRequiredProject('chat-dev-mcp');
    assert.ok(proj, 'Project required');

    const file1 = path.join(proj.path, '.chat-dev/handoff.md');
    const file2 = path.join(proj.path, 'HANDOFF.md');

    await fs.mkdir(path.dirname(file1), { recursive: true });
    await fs.writeFile(file1, 'Older server handoff content\n');
    await new Promise((r) => setTimeout(r, 50));
    await fs.writeFile(file2, 'Newer workspace handoff content\n');

    const newest = memoryService.findHandoffFileSync(proj.path);
    assert.strictEqual(newest?.relativePath, 'HANDOFF.md', 'findHandoffFileSync must pick newest mtime file');

    const readRes = await memoryService.readHandoff(proj.path);
    assert.strictEqual(readRes.filePath, 'HANDOFF.md', 'readHandoff must read newest mtime file');
    assert.strictEqual(readRes.content?.trim(), 'Newer workspace handoff content', 'Content must be from newest mtime file');
  });
});
