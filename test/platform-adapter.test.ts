import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPlatformAdapter } from '../src/platform/platformFactory.js';
import { MacOsPlatformAdapter } from '../src/platform/macos/macosAdapter.js';
import type { PlatformAdapter, AtomicReplaceRequest, AtomicReplaceResult, FileObservation, ObservationOptions, PlatformCapabilities } from '../src/platform/platformAdapter.js';
import { AtomicWriter } from '../src/mutation/atomicWriter.js';

class FailingAdapter implements PlatformAdapter {
  readonly platform: NodeJS.Platform = 'darwin';
  async getCapabilities(): Promise<PlatformCapabilities> {
    return {
      platform: 'darwin',
      atomicReplace: { supported: false, provider: 'test-failure', reason: 'forced failure' },
      pty: { supported: true, provider: 'test' },
    };
  }
  async atomicReplace(_request: AtomicReplaceRequest): Promise<AtomicReplaceResult> {
    const err: any = new Error('[ATOMIC_REPLACE_FAILED] forced');
    err.category = 'execution';
    err.code = 'ATOMIC_REPLACE_FAILED';
    throw err;
  }
  observeFilesystem(_root: string, _options?: ObservationOptions): Promise<FileObservation> {
    throw new Error('not used');
  }
  normalizePath(input: string): string { return input; }
}

describe('Phase 2 PlatformAdapter', () => {
  const testDir = path.resolve(process.cwd(), `tmp-platform-${Date.now()}`);

  before(async () => { await fs.mkdir(testDir, { recursive: true }); });
  after(async () => { await fs.rm(testDir, { recursive: true, force: true }); });

  it('selects the host platform adapter and exposes explicit capabilities', async () => {
    const adapter = createPlatformAdapter();
    const caps = await adapter.getCapabilities();
    assert.equal(caps.platform, process.platform);
    assert.equal(typeof caps.atomicReplace.supported, 'boolean');
    assert.ok(caps.atomicReplace.provider.length > 0);
  });

  it('macOS adapter observes content hashes and changes fingerprint when bytes change', async () => {
    const adapter = new MacOsPlatformAdapter();
    const file = path.join(testDir, 'observe.txt');
    await fs.writeFile(file, 'one');
    const first = await adapter.observeFilesystem(testDir, { exclude: [] });
    await fs.writeFile(file, 'two');
    const second = await adapter.observeFilesystem(testDir, { exclude: [] });
    assert.notEqual(first.fingerprint, second.fingerprint);
    assert.equal(second.entries[0]?.sha256, crypto.createHash('sha256').update('two').digest('hex'));
  });

  it('atomic replacement failure leaves the original target bit-identical', async () => {
    const file = path.join(testDir, 'safe.txt');
    const original = 'original bytes\n';
    await fs.writeFile(file, original);
    const hash = crypto.createHash('sha256').update(original).digest('hex');
    const writer = new AtomicWriter(new FailingAdapter());

    await assert.rejects(
      () => writer.writeAtomic(file, 'replacement\n', { expectedSha256: hash }),
      (err: any) => err.code === 'ATOMIC_REPLACE_FAILED'
    );

    assert.equal(await fs.readFile(file, 'utf8'), original);
  });
});
