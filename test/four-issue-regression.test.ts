import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { DiagnosticService } from '../src/services/diagnosticService.js';
import { PatchService } from '../src/services/patchService.js';
import { ProcessService } from '../src/services/processService.js';

describe('Four issue regression coverage', () => {
  it('terminates a timed-out foreground command by default', async () => {
    const processService = new ProcessService(process.cwd());
    const result = await processService.runCommand({
      command: 'node -e "setTimeout(() => {}, 2000)"',
      timeoutMs: 50,
    });

    assert.equal(result.status, 'timed_out');
    assert.equal(result.timedOut, true);
    assert.equal(result.promotedToBackground, false);
    assert.equal(result.processAlive, false);
    assert.equal(result.terminationSucceeded, true);
    assert.ok(result.taskId);
    assert.equal(processService.getTaskStatus(result.taskId!).found, false);
  });

  it('can explicitly detach a timed-out foreground command as a trackable background task', async () => {
    const processService = new ProcessService(process.cwd());
    let result: Awaited<ReturnType<ProcessService['runCommand']>> | undefined;

    try {
      result = await processService.runCommand({
        command: 'node -e "setTimeout(() => {}, 2000)"',
        timeoutMs: 50,
        detachOnTimeout: true,
      });

      assert.equal(result.status, 'timed_out');
      assert.equal(result.timedOut, true);
      assert.equal(result.promotedToBackground, true);
      assert.equal(result.processAlive, true);
      assert.ok(result.taskId);

      const status = processService.getTaskStatus(result.taskId!);
      assert.equal(status.found, true);
      assert.equal(status.task?.status, 'running');
      assert.equal(status.task?.timedOut, true);
    } finally {
      if (result?.taskId) {
        await processService.killTask(result.taskId);
      }
    }
  });

  it('applies standard unified diff headers with metadata and preserves hunk order', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'patch-regression-'));
    const filePath = path.join(root, 'retest-patch.txt');
    await fs.writeFile(filePath, 'alpha\nbeta\ngamma\ndelta\n', 'utf8');

    try {
      const diff = [
        'diff --git a/retest-patch.txt b/retest-patch.txt',
        'index 0000000..1111111 100644',
        '--- a/retest-patch.txt\t2026-08-22 12:00:00.000000000 +0700',
        '+++ b/retest-patch.txt\t2026-08-22 12:00:01.000000000 +0700',
        '@@ -1,4 +1,4 @@',
        ' alpha',
        '-beta',
        '+BETA',
        ' gamma',
        '-delta',
        '+DELTA',
        '',
      ].join('\n');

      const result = await new PatchService(root).applyUnifiedDiff(diff);
      assert.equal(result.success, true);
      assert.equal(await fs.readFile(filePath, 'utf8'), 'alpha\nBETA\ngamma\nDELTA\n');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('returns a structured parse error for malformed unified diff input', async () => {
    await assert.rejects(
      () => new PatchService(process.cwd()).applyUnifiedDiff('--- a/file.txt\n+++ b/file.txt\nthis is not a hunk'),
      (error: any) => {
        assert.equal(error.code, 'PATCH_PARSE_ERROR');
        assert.equal(error.supportedFormat, 'unified_diff');
        assert.match(error.message, /hunk/i);
        return true;
      },
    );
  });

  it('does not guess a Python toolchain when no diagnostic command is explicit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostic-toolchain-'));
    await fs.writeFile(path.join(root, 'pyproject.toml'), '[project]\nname = "fixture"\n', 'utf8');

    const calls: Array<{ command: string; cwd?: string }> = [];
    const fakeProcessService = {
      runCommand: async (options: { command: string; cwd?: string }) => {
        calls.push(options);
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    } as unknown as ProcessService;

    try {
      const diagnostics = new DiagnosticService(fakeProcessService, root);
      const result = await diagnostics.runDiagnostics('test');

      assert.equal(calls.length, 0);
      assert.equal(result.status, 'not_configured');
      assert.equal(result.commandRun, null);
      assert.match(result.summary, /explicit.*command|custom.*command/i);

      const explicit = await diagnostics.runDiagnostics('test', {
        command: 'python -m unittest discover -s tests -v',
      });
      assert.equal(explicit.commandRun, 'python -m unittest discover -s tests -v');
      assert.equal(calls[0].command, 'python -m unittest discover -s tests -v');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
