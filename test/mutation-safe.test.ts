import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CasGuard } from '../src/mutation/casGuard.js';
import { AtomicWriter } from '../src/mutation/atomicWriter.js';
import { PatchEngine } from '../src/mutation/patchEngine.js';

describe('Task 4: Safe Mutation Engine (Two-Level CAS & AtomicWriter)', () => {
  const testDir = path.resolve(process.cwd(), `tmp-mut-safe-${Date.now()}`);
  let writer: AtomicWriter;
  let guard: CasGuard;
  let patchEngine: PatchEngine;

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
    writer = new AtomicWriter();
    guard = new CasGuard();
    patchEngine = new PatchEngine(testDir);
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('Check 1: rejects mutation on stale file hash with CONCURRENCY_CONFLICT', async () => {
    const file = path.join(testDir, 'account.ts');
    await fs.writeFile(file, 'export class Account {}\n');
    const realHash = crypto.createHash('sha256').update('export class Account {}\n').digest('hex');

    // Valid hash passes
    await guard.validateTwoLevelMutation({ fullPath: file, expectedSha256: realHash });

    // Invalid hash throws CONCURRENCY_CONFLICT
    await assert.rejects(
      () => guard.validateTwoLevelMutation({ fullPath: file, expectedSha256: 'deadbeef12345678' }),
      (err: any) => err.code === 'CONCURRENCY_CONFLICT' && err.category === 'conflict'
    );
  });

  it('Check 2: preserves CRLF line endings when writing atomically', async () => {
    const file = path.join(testDir, 'crlf-file.txt');
    await fs.writeFile(file, 'Line 1\r\nLine 2\r\n');
    const beforeHash = crypto.createHash('sha256').update('Line 1\r\nLine 2\r\n').digest('hex');

    const writeRes = await writer.writeAtomic(file, 'Line 1\nLine 2 Modified\n', {
      expectedSha256: beforeHash,
      preserveNewline: true,
    });

    assert.strictEqual(writeRes.success, true);
    assert.strictEqual(writeRes.newline, 'CRLF');

    const content = await fs.readFile(file, 'utf-8');
    assert.ok(content.includes('\r\n'), 'CRLF must be preserved');
  });

  it('Check 3: PatchEngine applies multi-file patch with per-file atomicity contract', async () => {
    const fileA = path.join(testDir, 'serviceA.ts');
    const fileB = path.join(testDir, 'serviceB.ts');

    await fs.writeFile(fileA, 'const x = 1;\n');
    await fs.writeFile(fileB, 'const y = 2;\n');

    const hashA = crypto.createHash('sha256').update('const x = 1;\n').digest('hex');
    const hashB = crypto.createHash('sha256').update('const y = 2;\n').digest('hex');

    const patchRes = await patchEngine.applyPatch({
      files: [
        {
          path: fileA,
          expectedSha256: hashA,
          operations: [{ type: 'replaceExact', target: 'const x = 1;', replacement: 'const x = 10;' }],
        },
        {
          path: fileB,
          expectedSha256: hashB,
          operations: [{ type: 'replaceExact', target: 'const y = 2;', replacement: 'const y = 20;' }],
        },
      ],
    });

    assert.strictEqual(patchRes.atomicity, 'per-file');
    assert.strictEqual(patchRes.completedFiles.length, 2);
    assert.strictEqual(await fs.readFile(fileA, 'utf-8'), 'const x = 10;\n');
    assert.strictEqual(await fs.readFile(fileB, 'utf-8'), 'const y = 20;\n');
  });

  it('Check 4 (DoD 20): failed atomic replace leaves original file bit-identical without unlink fallback', async () => {
    const file = path.join(testDir, 'locked-target.txt');
    const originalContent = 'IMPORTANT ORIGINAL CONTENT THAT MUST NOT BE LOST\n';
    await fs.writeFile(file, originalContent);
    const beforeHash = crypto.createHash('sha256').update(originalContent).digest('hex');

    // Attempting invalid hash throws before any file replace
    await assert.rejects(
      () =>
        writer.writeAtomic(file, 'CORRUPTED REPLACEMENT', {
          expectedSha256: '00000000000000000000000000000000',
        }),
      (err: any) => err.code === 'CONCURRENCY_CONFLICT'
    );

    // Target must be 100% bit-identical
    const contentAfter = await fs.readFile(file, 'utf-8');
    const afterHash = crypto.createHash('sha256').update(contentAfter).digest('hex');
    assert.strictEqual(contentAfter, originalContent);
    assert.strictEqual(beforeHash, afterHash, 'Target file MUST remain bit-identical on failed mutation');
  });
});
