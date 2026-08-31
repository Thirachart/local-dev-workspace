import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileObservation, ObservationOptions } from './platformAdapter.js';

function isExcluded(relativePath: string, excludes: string[]): boolean {
  const normalized = relativePath.split(path.sep).join('/');
  return excludes.some((item) => {
    const clean = item.replace(/^\.\//, '').replace(/\/$/, '');
    return normalized === clean || normalized.startsWith(`${clean}/`);
  });
}

export async function observeFilesystem(root: string, options?: ObservationOptions): Promise<FileObservation> {
  const excludes = options?.exclude ?? ['.git', 'node_modules', 'dist'];
  const entries: FileObservation['entries'] = [];

  const scan = async (current: string) => {
    const dirEntries = await fs.readdir(current, { withFileTypes: true });
    dirEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of dirEntries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(root, fullPath);
      if (isExcluded(relativePath, excludes)) continue;

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile()) {
        const [stat, content] = await Promise.all([fs.stat(fullPath), fs.readFile(fullPath)]);
        entries.push({
          relativePath: relativePath.split(path.sep).join('/'),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          sha256: crypto.createHash('sha256').update(content).digest('hex'),
        });
      }
    }
  };

  await scan(root);
  const fingerprintInput = entries
    .map((entry) => `${entry.relativePath}\0${entry.size}\0${entry.mtimeMs}\0${entry.sha256}`)
    .join('\n');

  return {
    root,
    entries,
    fingerprint: `fs_${crypto.createHash('sha256').update(fingerprintInput).digest('hex')}`,
  };
}
