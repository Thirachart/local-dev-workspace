import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ProjectInstructionResult {
  exists: boolean;
  fileName: string | null;
  filePath: string | null;
  content: string | null;
}

export interface MemoryResult {
  exists: boolean;
  filePath: string;
  content: string | null;
  message?: string;
}

export class MemoryService {
  public static readonly INSTRUCTION_FILES = [
    'AGENTS.md',
    'agent.md',
    'CLAUDE.md',
    'claude.md',
    '.chat-dev/memory.md',
  ];

  public static readonly HANDOFF_FILES = [
    'HANDOFF.md',
    'handoff.md',
    '.handoff.md',
    '.chat-dev/handoff.md',
  ];

  public findProjectInstructionsSync(projectPath: string): ProjectInstructionResult {
    const root = path.resolve(projectPath);
    for (const fileName of MemoryService.INSTRUCTION_FILES) {
      const fullPath = path.join(root, fileName);
      if (fsSync.existsSync(fullPath)) {
        try {
          const content = fsSync.readFileSync(fullPath, 'utf-8');
          return {
            exists: true,
            fileName,
            filePath: fileName, // relative path only for security
            content,
          };
        } catch {
          // ignore error and continue
        }
      }
    }

    return {
      exists: false,
      fileName: null,
      filePath: null,
      content: null,
    };
  }

  public findHandoffFileSync(projectPath: string): { fullPath: string; relativePath: string; mtimeMs: number } | null {
    const root = path.resolve(projectPath);
    let newest: { fullPath: string; relativePath: string; mtimeMs: number } | null = null;
    for (const fileName of MemoryService.HANDOFF_FILES) {
      const fullPath = path.join(root, fileName);
      if (fsSync.existsSync(fullPath)) {
        try {
          const stats = fsSync.statSync(fullPath);
          if (!newest || stats.mtimeMs > newest.mtimeMs) {
            newest = { fullPath, relativePath: fileName, mtimeMs: stats.mtimeMs };
          }
        } catch {}
      }
    }
    return newest;
  }

  public async readHandoff(projectPath: string, customFilePath?: string): Promise<MemoryResult> {
    const root = path.resolve(projectPath);
    let targetPath: string | null = null;
    let targetRelative = 'HANDOFF.md';

    if (customFilePath && customFilePath.trim()) {
      targetRelative = customFilePath.trim();
      targetPath = path.join(root, targetRelative);
      if (!fsSync.existsSync(targetPath)) {
        targetPath = null;
      }
    } else {
      const existing = this.findHandoffFileSync(root);
      if (existing) {
        targetPath = existing.fullPath;
        targetRelative = existing.relativePath;
      }
    }

    if (!targetPath) {
      return {
        exists: false,
        filePath: targetRelative,
        content: null,
        message: `No session handoff file found (checked ${customFilePath || 'HANDOFF.md, handoff.md, .handoff.md, .chat-dev/handoff.md'}). You can create one using write_handoff.`,
      };
    }

    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      return {
        exists: true,
        filePath: targetRelative,
        content,
      };
    } catch (err: any) {
      return {
        exists: false,
        filePath: targetRelative,
        content: null,
        message: `Failed to read handoff file: ${err.message}`,
      };
    }
  }

  public async writeHandoff(
    projectPath: string,
    summaryOrContent: string | { content?: string; markdown?: string; summary?: string; nextSteps?: string[]; persist?: 'server' | 'workspace'; path?: string; filePath?: string },
    nextSteps: string[] = [],
    persist: 'server' | 'workspace' = 'server',
    customFilePath?: string
  ): Promise<MemoryResult> {
    let rawContent: string | undefined;
    let summaryText = typeof summaryOrContent === 'string' ? summaryOrContent : (summaryOrContent.summary || '');
    let stepsArr = typeof summaryOrContent === 'string' ? nextSteps : (summaryOrContent.nextSteps || []);
    let storageMode = typeof summaryOrContent === 'string' ? persist : (summaryOrContent.persist || 'server');
    let explicitPath = customFilePath || (typeof summaryOrContent === 'object' && summaryOrContent !== null ? (summaryOrContent.path || summaryOrContent.filePath) : undefined);

    if (typeof summaryOrContent === 'object' && summaryOrContent !== null) {
      if (summaryOrContent.content || summaryOrContent.markdown) {
        rawContent = (summaryOrContent.content || summaryOrContent.markdown || '').trim();
      }
    }

    const root = path.resolve(projectPath);
    let targetRelative: string;

    if (explicitPath && explicitPath.trim()) {
      targetRelative = explicitPath.trim();
    } else {
      const existing = this.findHandoffFileSync(root);
      targetRelative = existing ? existing.relativePath : (storageMode === 'workspace' ? 'HANDOFF.md' : '.chat-dev/handoff.md');
      if (!existing && storageMode === 'server') {
        targetRelative = '.chat-dev/handoff.md';
      } else if (!existing && storageMode === 'workspace') {
        targetRelative = 'HANDOFF.md';
      }
    }

    const targetFull = path.join(root, targetRelative);
    const dirPath = path.dirname(targetFull);

    if (!fsSync.existsSync(dirPath)) {
      await fs.mkdir(dirPath, { recursive: true });
    }

    let doc = '';
    if (rawContent !== undefined) {
      doc = rawContent.endsWith('\n') ? rawContent : rawContent + '\n';
    } else {
      const timestamp = new Date().toLocaleString('sv-SE').replace(' ', ' ');
      doc = `# 🔄 Session Handoff & Tasks (${timestamp})\n\n## 📌 Session Summary\n${summaryText.trim()}\n`;

      if (stepsArr && stepsArr.length > 0) {
        doc += `\n## 📋 Next Steps / TODOs for Next Session\n`;
        for (const step of stepsArr) {
          doc += `- [ ] ${step.trim()}\n`;
        }
      }
    }

    await fs.writeFile(targetFull, doc, 'utf-8');
    const bytesWritten = Buffer.byteLength(doc, 'utf-8');
    const sha256 = crypto.createHash('sha256').update(doc, 'utf-8').digest('hex');

    return {
      exists: true,
      filePath: targetRelative,
      content: doc,
      message: `Updated session handoff in ${targetRelative} (${bytesWritten} bytes written, sha256: ${sha256.slice(0, 10)})`,
    };
  }
}
