import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SearchService } from '../src/services/searchService.js';

test('searchFiles expands simple file patterns recursively', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'search-service-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'sample.ts'), 'const projectDiagnostics = true;');

  const service = new SearchService(root);
  const result = await service.searchFiles('projectDiagnostics', {
    filePattern: '*.ts',
  });

  assert.equal(result.totalMatches, 1);
  assert.equal(result.matches[0].file, 'src/sample.ts');

  await fs.rm(root, { recursive: true, force: true });
});
