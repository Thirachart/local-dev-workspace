import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProjectService } from './projectService.js';
import { AtomicWriter } from '../mutation/atomicWriter.js';

export type WriteFileMode = 'create_only' | 'replace_if_hash' | 'force';

export class FileService {
  public static readonly SENSITIVE_FILE_PATTERNS: RegExp[] = [
    /^\.env(\..+)?$/i,
    /\b(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$/i,
    /\.(pem|key|pfx|p12|keystore|kdbx)$/i,
    /^(credentials|service-account|serviceAccountKey|google-credentials)\.json$/i,
    /^(auth|tunnel-auth|tunnel-openai)\.json$/i,
    /\.npmrc$/i,
    /\.git-credentials$/i,
    /\.dockercfg$/i,
  ];

  public static readonly PROTECTED_DIRECTORIES: string[] = [
    'node_modules',
    '.git',
    '.venv',
    '__pycache__',
    '.cache',
    '.turbo',
  ];

  private projectService?: ProjectService;
  private baseDir: string;
  private atomicWriter = new AtomicWriter();
  private readCache = new Map<string, { sha256: string; mtimeMs: number }>();

  constructor(baseDir: string = process.cwd(), projectService?: ProjectService) {
    this.baseDir = path.resolve(baseDir);
    this.projectService = projectService;
  }

  public resolvePath(targetPath: string, customCwd?: string, projectName?: string): { fullPath: string; relPath: string; projectRoot: string } {
    if (this.projectService) {
      const verified = this.projectService.ensureWithinProject(targetPath, customCwd, projectName);
      return {
        fullPath: verified.resolvedPath,
        relPath: verified.relativePath,
        projectRoot: verified.project.path,
      };
    }
    const root = customCwd ? path.resolve(this.baseDir, customCwd) : this.baseDir;
    const full = path.resolve(root, targetPath);
    return {
      fullPath: full,
      relPath: path.relative(this.baseDir, full) || targetPath,
      projectRoot: this.baseDir,
    };
  }

  public validateAccess(
    targetPath: string,
    mode: 'read' | 'write' | 'delete',
    options?: { customCwd?: string; project?: string; allowSensitive?: boolean }
  ): { fullPath: string; relPath: string; projectRoot: string } {
    let verifiedProject: any;
    let fullPath: string;
    let relPath: string;
    let projectRoot: string;

    if (this.projectService) {
      const verified = this.projectService.ensureWithinProject(targetPath, options?.customCwd, options?.project);
      fullPath = verified.resolvedPath;
      relPath = verified.relativePath;
      projectRoot = verified.project.path;
      verifiedProject = verified.project;
    } else {
      const resolved = this.resolvePath(targetPath, options?.customCwd, options?.project);
      fullPath = resolved.fullPath;
      relPath = resolved.relPath;
      projectRoot = resolved.projectRoot;
    }

    const baseName = path.basename(fullPath);
    const normalizedRel = relPath.replace(/\\/g, '/');
    const segments = normalizedRel.split('/').filter(Boolean);

    // 1. Enforce Project-level Permissions
    if (verifiedProject?.permissions) {
      if (mode === 'read' && verifiedProject.permissions.canRead === false) {
        throw new Error(`[PERMISSION_DENIED] Read permission is disabled for project "${verifiedProject.name}".`);
      }
      if (mode === 'write' && verifiedProject.permissions.canWrite === false) {
        throw new Error(`[PERMISSION_DENIED] Write permission is disabled for project "${verifiedProject.name}".`);
      }
      if (mode === 'delete' && verifiedProject.permissions.canDelete === false) {
        throw new Error(`[PERMISSION_DENIED] Delete permission is disabled for project "${verifiedProject.name}".`);
      }
    }

    // 2. Sensitive credential file protection (e.g. .env, id_rsa, auth.json, keys)
    if (!options?.allowSensitive) {
      for (const pattern of FileService.SENSITIVE_FILE_PATTERNS) {
        if (pattern.test(baseName) || pattern.test(normalizedRel)) {
          throw new Error(`[SECURITY_BLOCKED] Access to sensitive credential file "${relPath}" is prohibited for security.`);
        }
      }
    }

    // 3. Protected Directory Guard (node_modules, .git, etc.)
    const hasProtectedDir = segments.some((seg) => FileService.PROTECTED_DIRECTORIES.includes(seg.toLowerCase()));
    if (hasProtectedDir) {
      if (mode === 'write' || mode === 'delete') {
        throw new Error(`[SECURITY_BLOCKED] Direct modification/deletion inside protected directory "${relPath}" is prohibited.`);
      }
      // For .git internal folder: always block reading internal git index/objects
      if (segments.some((seg) => seg.toLowerCase() === '.git')) {
        throw new Error(`[SECURITY_BLOCKED] Direct access to internal VCS directory "${relPath}" is prohibited.`);
      }
    }

    return { fullPath, relPath, projectRoot };
  }

  public async readFile(
    targetPath: string,
    options?: {
      startLine?: number;
      endLine?: number;
      customCwd?: string;
      project?: string;
      allowSensitive?: boolean;
      knownSha256?: string;
      sessionId?: string;
    }
  ): Promise<{
    content: string;
    totalLines: number;
    startLine: number;
    endLine: number;
    resolvedPath: string;
    sha256: string;
    status: 'clean' | 'unchanged';
  }> {
    const { fullPath, relPath } = this.validateAccess(targetPath, 'read', options);
    const rawContent = await fs.readFile(fullPath, 'utf-8');
    const sha256 = crypto.createHash('sha256').update(rawContent, 'utf-8').digest('hex');

    const clientKnown = options?.knownSha256?.trim().toLowerCase();
    const cacheKey = `${options?.sessionId || 'global'}:${fullPath}`;
    const cached = this.readCache.get(cacheKey);
    const isUnchanged = (clientKnown && clientKnown === sha256.toLowerCase()) || (cached && cached.sha256 === sha256 && !!options?.sessionId);

    this.readCache.set(cacheKey, { sha256, mtimeMs: Date.now() });

    const isCrlf = rawContent.includes('\r\n');
    const lines = rawContent.split(/\r?\n/);
    const totalLines = lines.length;

    let start = 1;
    let end = totalLines;

    if (options?.startLine && options.startLine > 0) {
      start = Math.min(options.startLine, totalLines);
    }
    if (options?.endLine && options.endLine >= start) {
      end = Math.min(options.endLine, totalLines);
    }

    const isFullFile = (!options?.startLine || options.startLine <= 1) && (!options?.endLine || options.endLine >= totalLines);
    const selectedLines = lines.slice(start - 1, end);
    const content = isFullFile ? rawContent : selectedLines.join(isCrlf ? '\r\n' : '\n');

    return {
      content,
      totalLines,
      startLine: start,
      endLine: end,
      resolvedPath: relPath,
      sha256,
      status: isUnchanged ? 'unchanged' : 'clean',
    };
  }

  public async writeFile(
    targetPath: string,
    content: string,
    options?: {
      customCwd?: string;
      project?: string;
      allowSensitive?: boolean;
      mode?: WriteFileMode;
      expectedBeforeHash?: string;
    }
  ): Promise<{
    success: boolean;
    operationId: string;
    action: 'created' | 'replaced';
    path: string;
    bytesWritten: number;
    beforeHash: string;
    afterHash: string;
    replacementProvider: string;
  }> {
    const { fullPath, relPath } = this.validateAccess(targetPath, 'write', options);
    const exists = fsSync.existsSync(fullPath);
    const mode = options?.mode || 'create_only';

    if (mode === 'create_only' && exists) {
      const err: any = new Error(`[FILE_EXISTS] File "${relPath}" already exists. Use mode="replace_if_hash" with expected_before_hash, or mode="force" explicitly.`);
      err.category = 'conflict';
      err.code = 'FILE_EXISTS';
      throw err;
    }

    if (mode === 'replace_if_hash') {
      if (!exists) {
        const err: any = new Error(`[FILE_NOT_FOUND] Cannot replace "${relPath}" because it does not exist.`);
        err.category = 'validation';
        err.code = 'FILE_NOT_FOUND';
        throw err;
      }
      if (!options?.expectedBeforeHash?.trim()) {
        const err: any = new Error('[EXPECTED_HASH_REQUIRED] mode="replace_if_hash" requires expected_before_hash.');
        err.category = 'validation';
        err.code = 'EXPECTED_HASH_REQUIRED';
        throw err;
      }
    }

    const result = await this.atomicWriter.writeAtomic(fullPath, content, {
      expectedSha256: options?.expectedBeforeHash || undefined,
      preserveNewline: true,
    });

    return {
      success: true,
      operationId: `op_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      action: exists ? 'replaced' : 'created',
      path: relPath, // Return sanitized relative path
      bytesWritten: result.bytesWritten,
      beforeHash: result.beforeSha256,
      afterHash: result.afterSha256,
      replacementProvider: result.replacementProvider,
    };
  }

  public async editFile(
    targetPath: string,
    targetContent: string,
    replacementContent: string,
    options?: { allowMultiple?: boolean; expectedBeforeHash?: string; customCwd?: string; project?: string; allowSensitive?: boolean }
  ): Promise<{
    success: boolean;
    path: string;
    occurrencesReplaced: number;
    matchedAtLine?: number;
    matchedLines?: number[];
    bytesWritten: number;
    beforeHash: string;
    afterHash: string;
    outsidePatchUnchanged: boolean;
  }> {
    const { fullPath, relPath } = this.validateAccess(targetPath, 'write', options);
    const existingContent = await fs.readFile(fullPath, 'utf-8');

    // 0. Optimistic Concurrency / CAS Hash Check
    const crypto = await import('node:crypto');
    const beforeHash = crypto.createHash('sha256').update(existingContent, 'utf-8').digest('hex');

    if (options?.expectedBeforeHash) {
      const expected = options.expectedBeforeHash.trim().toLowerCase();
      if (expected !== beforeHash.toLowerCase()) {
        throw new Error(
          `CONCURRENCY_CONFLICT: File "${relPath}" has been modified externally. Expected hash: ${expected}, but current hash is: ${beforeHash}. Aborting edit to prevent overwriting concurrent work.`
        );
      }
    }

    // 1. Detect file's native newline style
    const isCrlf = existingContent.includes('\r\n');

    // 2. Normalize target and replacement to match the file's native newline style
    let normalizedTarget = targetContent;
    let normalizedReplacement = replacementContent;

    if (isCrlf) {
      normalizedTarget = targetContent.replace(/\r?\n/g, '\r\n');
      normalizedReplacement = replacementContent.replace(/\r?\n/g, '\r\n');
    } else {
      normalizedTarget = targetContent.replace(/\r\n/g, '\n');
      normalizedReplacement = replacementContent.replace(/\r\n/g, '\n');
    }

    // 3. Strict verification of target existence
    if (!existingContent.includes(normalizedTarget)) {
      throw new Error(
        `Target content to replace was not found in file: ${relPath}. Ensure the target text matches exact characters, indentation, and whitespace.`
      );
    }

    let occurrences = 0;
    let newContent = '';
    const matchedLines: number[] = [];

    if (options?.allowMultiple) {
      let searchIdx = 0;
      while ((searchIdx = existingContent.indexOf(normalizedTarget, searchIdx)) !== -1) {
        const lineNum = existingContent.substring(0, searchIdx).split(/\r?\n/).length;
        matchedLines.push(lineNum);
        searchIdx += normalizedTarget.length;
      }

      const parts = existingContent.split(normalizedTarget);
      occurrences = parts.length - 1;
      newContent = parts.join(normalizedReplacement);
    } else {
      const firstIndex = existingContent.indexOf(normalizedTarget);
      if (firstIndex < 0) {
        throw new Error(`Assertion failed: Target content index not found in ${relPath}.`);
      }

      const secondIndex = existingContent.indexOf(normalizedTarget, firstIndex + normalizedTarget.length);
      if (secondIndex !== -1) {
        throw new Error(
          `Found multiple occurrences of target content in ${relPath}. Please specify a larger surrounding context or set allowMultiple=true.`
        );
      }

      const matchedLine = existingContent.substring(0, firstIndex).split(/\r?\n/).length;
      matchedLines.push(matchedLine);

      const before = existingContent.substring(0, firstIndex);
      const after = existingContent.substring(firstIndex + normalizedTarget.length);

      // Verify prefix + target + suffix reconstruction matches existing content exactly
      if (before + normalizedTarget + after !== existingContent) {
        throw new Error(`Buffer integrity check failed prior to writing ${relPath}. Aborting replacement.`);
      }

      occurrences = 1;
      newContent = before + normalizedReplacement + after;
    }

    // 4. Atomic write with fsync in the exact same directory
    const tempDir = path.dirname(fullPath);
    const tempFileName = `.tmp.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const tempPath = path.join(tempDir, tempFileName);

    try {
      const handle = await fs.open(tempPath, 'w');
      await handle.writeFile(newContent, 'utf-8');
      await handle.sync(); // FSYNC flush to physical disk
      await handle.close();
      await fs.rename(tempPath, fullPath);
    } catch (writeErr) {
      try {
        await fs.unlink(tempPath);
      } catch {}
      throw writeErr;
    }

    const stats = await fs.stat(fullPath);
    const afterHash = crypto.createHash('sha256').update(newContent, 'utf-8').digest('hex');

    return {
      success: true,
      path: relPath,
      occurrencesReplaced: occurrences,
      matchedAtLine: matchedLines[0],
      matchedLines,
      bytesWritten: stats.size,
      beforeHash,
      afterHash,
      outsidePatchUnchanged: true,
    };
  }

  public async listDirectory(
    dirPath: string = '.',
    options?: { recursive?: boolean; maxDepth?: number; customCwd?: string; project?: string; allowSensitive?: boolean }
  ): Promise<{ project: string; targetDir: string; items: Array<{ name: string; path: string; isDirectory: boolean; size?: number }> }> {
    const { fullPath, relPath } = this.validateAccess(dirPath, 'read', options);
    const results: Array<{ name: string; path: string; isDirectory: boolean; size?: number }> = [];

    const walk = async (currentDir: string, currentDepth: number) => {
      if (options?.maxDepth !== undefined && currentDepth > options.maxDepth) {
        return;
      }

      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip node_modules, .git, and sensitive credential files when listing
        if (FileService.PROTECTED_DIRECTORIES.includes(entry.name)) {
          if (options?.recursive || currentDepth > 1) continue;
        }

        if (!options?.allowSensitive) {
          const isSensitive = FileService.SENSITIVE_FILE_PATTERNS.some((p) => p.test(entry.name));
          if (isSensitive) continue;
        }

        const entryPath = path.join(currentDir, entry.name);
        const relEntry = path.relative(fullPath, entryPath);
        const isDir = entry.isDirectory();

        let size: number | undefined;
        if (!isDir) {
          try {
            const stat = await fs.stat(entryPath);
            size = stat.size;
          } catch {
            // Ignore
          }
        }

        results.push({
          name: entry.name,
          path: relEntry || entry.name,
          isDirectory: isDir,
          size,
        });

        if (isDir && options?.recursive && !FileService.PROTECTED_DIRECTORIES.includes(entry.name)) {
          await walk(entryPath, currentDepth + 1);
        }
      }
    };

    await walk(fullPath, 1);

    const projectName = options?.project || 'Unknown Project';
    return {
      project: projectName,
      targetDir: relPath || '.',
      items: results,
    };
  }

  public async deleteFile(
    targetPath: string,
    options?: { recursive?: boolean; force?: boolean; customCwd?: string; project?: string; allowSensitive?: boolean }
  ): Promise<{ success: boolean; path: string; deleted: boolean }> {
    const { fullPath, relPath } = this.validateAccess(targetPath, 'delete', options);
    if (!fsSync.existsSync(fullPath)) {
      if (options?.force) {
        return { success: true, path: relPath, deleted: false };
      }
      throw new Error(`File or directory does not exist: "${relPath}"`);
    }

    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      await fs.rm(fullPath, { recursive: true, force: options?.force });
    } else {
      await fs.unlink(fullPath);
    }

    return { success: true, path: relPath, deleted: true };
  }

  public async moveFile(
    sourcePath: string,
    destPath: string,
    options?: { overwrite?: boolean; customCwd?: string; project?: string; allowSensitive?: boolean }
  ): Promise<{ success: boolean; from: string; to: string }> {
    const { fullPath: srcFull, relPath: srcRel } = this.validateAccess(sourcePath, 'delete', options);
    const { fullPath: dstFull, relPath: dstRel } = this.validateAccess(destPath, 'write', options);

    if (!fsSync.existsSync(srcFull)) {
      throw new Error(`Source file does not exist: "${srcRel}"`);
    }

    if (fsSync.existsSync(dstFull) && !options?.overwrite) {
      throw new Error(`Destination already exists: "${dstRel}". Set overwrite: true if intended.`);
    }

    const destDir = path.dirname(dstFull);
    if (!fsSync.existsSync(destDir)) {
      await fs.mkdir(destDir, { recursive: true });
    }

    await fs.rename(srcFull, dstFull);
    return { success: true, from: srcRel, to: dstRel };
  }

  public async hashFile(
    targetPath: string,
    options?: { customCwd?: string; project?: string; allowSensitive?: boolean }
  ): Promise<{ path: string; sha256: string; sizeBytes: number }> {
    const crypto = await import('node:crypto');
    const { fullPath, relPath } = this.validateAccess(targetPath, 'read', options);
    if (!fsSync.existsSync(fullPath)) {
      throw new Error(`File does not exist: "${relPath}"`);
    }

    const content = await fs.readFile(fullPath);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const stat = await fs.stat(fullPath);

    return { path: relPath, sha256, sizeBytes: stat.size };
  }

  public async compareFileContent(
    pathA: string,
    pathB: string,
    options?: { customCwd?: string; project?: string; allowSensitive?: boolean }
  ): Promise<{
    identical: boolean;
    pathA: string;
    pathB: string;
    hashA: string;
    hashB: string;
    sizeA: number;
    sizeB: number;
  }> {
    const crypto = await import('node:crypto');
    const { fullPath: fullA, relPath: relA } = this.validateAccess(pathA, 'read', options);
    const { fullPath: fullB, relPath: relB } = this.validateAccess(pathB, 'read', options);

    if (!fsSync.existsSync(fullA)) throw new Error(`File A does not exist: "${relA}"`);
    if (!fsSync.existsSync(fullB)) throw new Error(`File B does not exist: "${relB}"`);

    const contentA = await fs.readFile(fullA);
    const contentB = await fs.readFile(fullB);

    const hashA = crypto.createHash('sha256').update(contentA).digest('hex');
    const hashB = crypto.createHash('sha256').update(contentB).digest('hex');

    return {
      identical: hashA === hashB,
      pathA: relA,
      pathB: relB,
      hashA,
      hashB,
      sizeA: contentA.length,
      sizeB: contentB.length,
    };
  }
}
