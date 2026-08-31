import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProcessService } from '../src/services/processService.js';
import { getGitObservation } from '../src/git-intel/gitObservation.js';
import { ContextLedger } from '../src/context/contextLedger.js';
import { DeliveryPlanner } from '../src/context/deliveryPlanner.js';
import { listPublicToolMetadata } from '../src/tools/registry.js';
import { ReferenceService } from '../src/code-intel/referenceService.js';

const tmpRoot = path.resolve(process.cwd(), `tmp-phase2-${Date.now()}`);

describe('MCP v2 Phase 2 conformance', () => {
  before(async () => { await fs.mkdir(tmpRoot, { recursive: true }); });
  after(async () => { await fs.rm(tmpRoot, { recursive: true, force: true }); });

  it('Context Ledger delivers full, unchanged, then diff only with explicit known hash', () => {
    const ledger = new ContextLedger();
    const planner = new DeliveryPlanner(ledger);
    const first = planner.plan({ scope: 'p1', key: 'a.ts:1-2', content: 'a\nb' });
    assert.equal(first.delivery, 'full');
    assert.ok(first.sha256);
    planner.commit({ scope: 'p1', projectId: 'p1', key: 'a.ts:1-2', content: 'a\nb', plan: first });

    const second = planner.plan({ scope: 'p1', key: 'a.ts:1-2', content: 'a\nb', knownSha256: first.sha256 });
    assert.equal(second.delivery, 'unchanged');
    assert.equal(second.deliveryId, first.deliveryId);
    planner.commit({ scope: 'p1', projectId: 'p1', key: 'a.ts:1-2', content: 'a\nb', plan: second });

    const third = planner.plan({ scope: 'p1', key: 'a.ts:1-2', content: 'a\nc', knownSha256: first.sha256 });
    assert.equal(third.delivery, 'diff');
    assert.notEqual(third.deliveryId, first.deliveryId);
    assert.match(third.patch || '', /-b/);
    assert.match(third.patch || '', /\+c/);
    planner.commit({ scope: 'p1', projectId: 'p1', key: 'a.ts:1-2', content: 'a\nc', plan: third });
    const record = ledger.get('p1', 'a.ts:1-2', third.sha256)!;
    assert.equal(record.deliveryId, third.deliveryId);
    assert.equal('content' in record, false);
  });

  it('public registry metadata exactly covers registered tool names', async () => {
    const source = await fs.readFile(path.resolve(process.cwd(), 'src/tools/index.ts'), 'utf8');
    const registered = [...source.matchAll(/registerTool\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
    const metadata = listPublicToolMetadata().map((item) => item.name).sort();
    assert.deepEqual(metadata, registered);
    assert.ok(metadata.length > 0);
    for (const item of listPublicToolMetadata()) {
      assert.ok(item.capability);
      assert.ok(item.snapshotPolicy);
      assert.ok(item.compatibility);
    }
  });

  it('GitObservation changes when index state changes', async () => {
    const repo = path.join(tmpRoot, 'git-observation');
    await fs.mkdir(repo, { recursive: true });
    const proc = new ProcessService(repo);
    await proc.runCommand({ command: 'git init', cwd: repo });
    await proc.runCommand({ command: 'git config user.name "Tester"', cwd: repo });
    await proc.runCommand({ command: 'git config user.email "test@example.com"', cwd: repo });
    await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
    const addResult = await proc.runCommand({ command: 'git add a.txt', cwd: repo });
    assert.equal(addResult.exitCode, 0, addResult.stderr || addResult.stdout);
    const commitResult = await proc.runCommand({ command: 'git commit -m init', cwd: repo });
    assert.equal(commitResult.exitCode, 0, commitResult.stderr || commitResult.stdout);
    const before = await getGitObservation(proc, repo);
    await fs.writeFile(path.join(repo, 'a.txt'), 'two\n');
    await proc.runCommand({ command: 'git add a.txt', cwd: repo });
    const after = await getGitObservation(proc, repo);
    assert.notEqual(before.observationId, after.observationId);
    assert.notEqual(before.indexFingerprint, after.indexFingerprint);
  });

  it('TypeScript unique symbol references are compiler-semantic', async () => {
    const dir = path.join(tmpRoot, 'ts-semantic');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext' }, include: ['*.ts'] }));
    const a = path.join(dir, 'a.ts');
    const b = path.join(dir, 'b.ts');
    await fs.writeFile(a, 'export function uniqueThing() { return 1; }\n');
    await fs.writeFile(b, 'import { uniqueThing } from "./a";\nexport const x = uniqueThing();\n');
    const refs = await new ReferenceService().findReferencesInFiles('uniqueThing', [a, b], 20);
    assert.ok(refs.length >= 2);
    assert.ok(refs.every((ref) => ref.semantic === true));
    assert.ok(refs.every((ref) => ref.engine === 'typescript-checker'));
  });

  it('ambiguous TypeScript symbol falls back honestly instead of claiming semantic certainty', async () => {
    const dir = path.join(tmpRoot, 'ts-ambiguous');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022' }, include: ['*.ts'] }));
    const a = path.join(dir, 'a.ts');
    const b = path.join(dir, 'b.ts');
    await fs.writeFile(a, 'export function sameName() { return 1; }\n');
    await fs.writeFile(b, 'export function sameName() { return 2; }\n');
    const refs = await new ReferenceService().findReferencesInFiles('sameName', [a, b], 20);
    assert.ok(refs.length >= 2);
    assert.ok(refs.every((ref) => ref.semantic === false));
    assert.ok(refs.every((ref) => ref.engine === 'text-fallback'));
    assert.ok(refs.every((ref) => (ref.limitations || []).length > 0));
  });
});
