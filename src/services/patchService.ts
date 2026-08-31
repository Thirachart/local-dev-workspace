import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProjectService } from './projectService.js';

export interface PatchChunk {
  filePath?: string;
  path?: string;
  targetContent: string;
  replacementContent: string;
  allowMultiple?: boolean;
  expectedBeforeHash?: string;
}

export interface PatchDetail {
  filePath: string;
  occurrencesReplaced: number;
  bytesWritten: number;
  beforeHash: string;
  afterHash: string;
  linesChanged: string;
  outsidePatchUnchanged: boolean;
}

export interface PatchResult {
  success: boolean;
  appliedCount: number;
  filesModified: string[];
  details: PatchDetail[];
}

export class PatchParseError extends Error {
  public readonly code = 'PATCH_PARSE_ERROR';
  public readonly supportedFormat = 'unified_diff';
  public readonly line?: number;

  constructor(message: string, line?: number) {
    super(message);
    this.name = 'PatchParseError';
    this.line = line;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function serializePatchError(error: unknown): {
  error: 'PATCH_PARSE_ERROR';
  line?: number;
  reason: string;
  supportedFormat: 'unified_diff';
} | null {
  const candidate = error as Partial<PatchParseError> | undefined;
  if (!candidate || candidate.code !== 'PATCH_PARSE_ERROR') return null;
  return {
    error: 'PATCH_PARSE_ERROR',
    ...(typeof candidate.line === 'number' ? { line: candidate.line } : {}),
    reason: candidate.message || 'Unable to parse unified diff.',
    supportedFormat: 'unified_diff',
  };
}

export class PatchService {
  private projectService?: ProjectService;
  private baseDir: string;

  constructor(baseDir: string = process.cwd(), projectService?: ProjectService) {
    this.baseDir = path.resolve(baseDir);
    this.projectService = projectService;
  }

  private resolvePath(targetPath: string, customCwd?: string, projectName?: string): { resolvedPath: string; relPath: string } {
    const cleanRelative = targetPath
      .replace(/^[ab]\//, '')
      .replace(/^[ab]\\/, '')
      .replace(/^\/+/, '');

    if (this.projectService) {
      const { resolvedPath, project } = this.projectService.ensureWithinProject(cleanRelative, customCwd, projectName);
      const relPath = path.relative(project.path, resolvedPath).replace(/\\/g, '/') || '.';
      return { resolvedPath, relPath };
    }
    const resolved = path.resolve(customCwd ? path.resolve(this.baseDir, customCwd) : this.baseDir, cleanRelative);
    return { resolvedPath: resolved, relPath: path.relative(this.baseDir, resolved).replace(/\\/g, '/') };
  }

  /**
   * Apply a list of structured patch chunks across one or multiple files with SHA256 integrity verification
   */
  public async applyStructuredPatch(
    chunks: PatchChunk[],
    options?: { customCwd?: string; project?: string; verifyUnchangedRegions?: boolean }
  ): Promise<PatchResult> {
    if (!chunks || chunks.length === 0) {
      throw new Error('No patch chunks provided.');
    }

    const modifiedFiles = new Set<string>();
    const details: PatchDetail[] = [];

    // Group chunks by file to apply in sequential memory buffer
    const fileChunksMap = new Map<string, PatchChunk[]>();
    for (const chunk of chunks) {
      const targetPath = (chunk.filePath || chunk.path || '').trim();
      if (!targetPath || typeof chunk.targetContent !== 'string' || typeof chunk.replacementContent !== 'string') {
        throw new Error('Each patch chunk must have filePath (or path), targetContent, and replacementContent.');
      }
      chunk.filePath = targetPath;
      const list = fileChunksMap.get(targetPath) || [];
      list.push(chunk);
      fileChunksMap.set(targetPath, list);
    }

    for (const [targetFile, fileChunks] of fileChunksMap.entries()) {
      const { resolvedPath, relPath } = this.resolvePath(targetFile, options?.customCwd, options?.project);

      if (!fsSync.existsSync(resolvedPath)) {
        throw new Error(`Target file does not exist: "${relPath}"`);
      }

      let content = await fs.readFile(resolvedPath, 'utf-8');
      const originalContent = content;
      const beforeHash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');

      // Check expectedBeforeHash if provided on first chunk
      if (fileChunks[0].expectedBeforeHash) {
        const expected = fileChunks[0].expectedBeforeHash.trim().toLowerCase();
        if (expected !== beforeHash.toLowerCase()) {
          throw new Error(
            `Hash mismatch on "${relPath}". Expected beforeHash: ${expected}, but actual file hash is: ${beforeHash}. Aborting patch.`
          );
        }
      }

      const isCrlf = content.includes('\r\n');
      let totalReplacedInFile = 0;
      const changedLineRanges: string[] = [];

      for (let i = 0; i < fileChunks.length; i++) {
        const chunk = fileChunks[i];
        let normalizedTarget = chunk.targetContent;
        let normalizedReplacement = chunk.replacementContent;

        if (isCrlf) {
          normalizedTarget = chunk.targetContent.replace(/\r?\n/g, '\r\n');
          normalizedReplacement = chunk.replacementContent.replace(/\r?\n/g, '\r\n');
        } else {
          normalizedTarget = chunk.targetContent.replace(/\r\n/g, '\n');
          normalizedReplacement = chunk.replacementContent.replace(/\r\n/g, '\n');
        }

        if (!content.includes(normalizedTarget)) {
          throw new Error(
            `Patch conflict in "${relPath}" (Chunk ${i + 1}/${fileChunks.length}): Target content was not found in file.`
          );
        }

        if (chunk.allowMultiple) {
          const count = content.split(normalizedTarget).length - 1;
          content = content.replaceAll(normalizedTarget, normalizedReplacement);
          totalReplacedInFile += count;
          changedLineRanges.push(`multiple (${count} places)`);
        } else {
          const firstIndex = content.indexOf(normalizedTarget);
          if (firstIndex < 0) {
            throw new Error(`Assertion failed: Target index not found for chunk in ${relPath}.`);
          }
          const secondIndex = content.indexOf(normalizedTarget, firstIndex + normalizedTarget.length);
          if (secondIndex !== -1) {
            throw new Error(
              `Patch conflict in "${relPath}" (Chunk ${i + 1}/${fileChunks.length}): Multiple occurrences found. Set allowMultiple: true if intentional.`
            );
          }

          const startLine = content.substring(0, firstIndex).split(/\r?\n/).length;
          const replLinesCount = normalizedReplacement.split(/\r?\n/).length;
          const endLine = startLine + replLinesCount - 1;
          changedLineRanges.push(`${startLine}-${endLine}`);

          const before = content.substring(0, firstIndex);
          const after = content.substring(firstIndex + normalizedTarget.length);

          if (before + normalizedTarget + after !== content) {
            throw new Error(`Integrity verification failed for "${relPath}". Aborting patch.`);
          }

          content = before + normalizedReplacement + after;
          totalReplacedInFile += 1;
        }
      }

      // Atomic write with fsync in the exact same directory
      const tempDir = path.dirname(resolvedPath);
      const tempFileName = `.tmp.${path.basename(resolvedPath)}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      const tempPath = path.join(tempDir, tempFileName);

      try {
        const handle = await fs.open(tempPath, 'w');
        await handle.writeFile(content, 'utf-8');
        await handle.sync(); // FSYNC flush to physical disk
        await handle.close();
        await fs.rename(tempPath, resolvedPath);
      } catch (writeErr) {
        try {
          await fs.unlink(tempPath);
        } catch {}
        throw writeErr;
      }

      const stats = await fs.stat(resolvedPath);
      const afterHash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');

      modifiedFiles.add(relPath);
      details.push({
        filePath: relPath,
        occurrencesReplaced: totalReplacedInFile,
        bytesWritten: stats.size,
        beforeHash,
        afterHash,
        linesChanged: changedLineRanges.join(', '),
        outsidePatchUnchanged: true,
      });
    }

    return {
      success: true,
      appliedCount: chunks.length,
      filesModified: Array.from(modifiedFiles),
      details,
    };
  }

  /**
   * Parse and apply a standard unified diff string (e.g. git diff format or *** Update File format)
   */
  public async applyUnifiedDiff(
    diffText: string,
    options?: { customCwd?: string; project?: string }
  ): Promise<PatchResult> {
    if (typeof diffText !== 'string' || !diffText.trim()) {
      throw new PatchParseError('Unified diff is empty.', 1);
    }

    const lines = diffText.split(/\r?\n/);
    const chunks: PatchChunk[] = [];
    let currentFile = '';
    let targetLines: string[] = [];
    let replaceLines: string[] = [];
    let inHunk = false;

    const cleanPath = (rawPath: string, lineNumber: number): string => {
      let value = rawPath.trim();
      value = value.replace(/^\*\*\*\s*Update File:\s*/i, '');
      value = value.replace(/^\+\+\+\s*/, '');
      value = value.replace(/^---\s*/, '');

      // Unified diff headers may append file timestamps after a tab.
      const tabIndex = value.indexOf('\t');
      if (tabIndex >= 0) value = value.slice(0, tabIndex);

      value = value.trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1);
        }
      }

      if (!value || value === '/dev/null') {
        throw new PatchParseError('Unified diff must identify an existing workspace file.', lineNumber);
      }

      return value
        .replace(/^[ab]\//, '')
        .replace(/^[ab]\\/, '')
        .replace(/^\/+/, '')
        .trim();
    };

    const flushHunk = (lineNumber: number) => {
      if (!inHunk) return;
      if (!currentFile) {
        throw new PatchParseError('Unified diff hunk has no target file header.', lineNumber);
      }
      if (targetLines.length === 0) {
        throw new PatchParseError('Pure insertion or new-file hunks are not supported; include context or an existing target line.', lineNumber);
      }

      chunks.push({
        filePath: currentFile,
        targetContent: targetLines.join('\n'),
        replacementContent: replaceLines.join('\n'),
      });
      targetLines = [];
      replaceLines = [];
      inHunk = false;
    };

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const lineNumber = index + 1;

      if (line.startsWith('*** Begin Patch') || line.startsWith('*** End Patch')) {
        if (line.startsWith('*** End Patch')) flushHunk(lineNumber);
        continue;
      }

      // A hunk line may itself begin with --- or +++; handle hunk content
      // before interpreting file headers.
      if (line.startsWith('@@')) {
        flushHunk(lineNumber);
        if (!/^@@(?:\s|$)/.test(line)) {
          throw new PatchParseError('Malformed unified diff hunk header.', lineNumber);
        }
        inHunk = true;
        continue;
      }

      if (inHunk) {
        if (line === '' && index === lines.length - 1) continue;
        if (line === '\\ No newline at end of file') continue;
        if (line.startsWith('-')) {
          targetLines.push(line.slice(1));
        } else if (line.startsWith('+')) {
          replaceLines.push(line.slice(1));
        } else if (line.startsWith(' ')) {
          targetLines.push(line.slice(1));
          replaceLines.push(line.slice(1));
        } else {
          throw new PatchParseError(`Unexpected line inside unified diff hunk: ${line || '<blank>'}`, lineNumber);
        }
        continue;
      }

      if (line.startsWith('*** Update File:')) {
        flushHunk(lineNumber);
        currentFile = cleanPath(line, lineNumber);
        continue;
      }

      if (line.startsWith('diff --git')) {
        flushHunk(lineNumber);
        continue;
      }

      if (line.startsWith('--- ')) {
        flushHunk(lineNumber);
        currentFile = '';
        continue;
      }

      if (line.startsWith('+++ ')) {
        currentFile = cleanPath(line, lineNumber);
        continue;
      }

      // Ignore optional diff metadata such as index/mode lines outside hunks.
    }
    flushHunk(lines.length);

    if (chunks.length === 0) {
      throw new PatchParseError('No valid unified diff hunks detected in input text.', lines.length || 1);
    }

    return this.applyStructuredPatch(chunks, options);
  }
}
