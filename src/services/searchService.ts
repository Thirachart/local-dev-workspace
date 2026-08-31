import { glob } from 'glob';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ProjectService } from './projectService.js';

export interface SearchMatch {
  file: string;
  lineNumber: number;
  lineContent: string;
}

export class SearchService {
  public static readonly DEFAULT_IGNORES: string[] = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/bin/**',
    '**/.cache/**',
    '**/.venv/**',
    '**/__pycache__/**',
    '**/.turbo/**',
    '**/.next/**',
    '**/.env*',
    '**/auth.json',
    '**/tunnel-auth.json',
    '**/tunnel-openai.json',
    '**/*.pem',
    '**/*.key',
    '**/id_rsa*',
    '**/credentials.json',
    '**/service-account*.json',
  ];

  private projectService?: ProjectService;
  private baseDir: string;

  constructor(baseDir: string = process.cwd(), projectService?: ProjectService) {
    this.baseDir = path.resolve(baseDir);
    this.projectService = projectService;
  }

  private resolvePath(targetPath: string, customCwd?: string, projectName?: string): string {
    if (this.projectService) {
      return this.projectService.ensureWithinProject(targetPath, customCwd, projectName).resolvedPath;
    }
    if (path.isAbsolute(targetPath)) {
      return path.resolve(targetPath);
    }
    const root = customCwd ? path.resolve(this.baseDir, customCwd) : this.baseDir;
    return path.resolve(root, targetPath);
  }

  public async findFiles(
    pattern: string = '**/*',
    options?: { customCwd?: string; ignore?: string[]; project?: string }
  ): Promise<string[]> {
    const rootDir = this.resolvePath('.', options?.customCwd, options?.project);
    const ignoreList = options?.ignore || SearchService.DEFAULT_IGNORES;

    // Treat simple patterns like '*.ts' as recursive source searches.
    // glob's '*.ts' only matches files directly under cwd, which caused
    // searchFiles to silently miss files under src/ and other folders.
    const normalizedPattern = pattern.includes('/') || pattern.includes('**')
      ? pattern
      : `**/${pattern}`;

    const matches = await glob(normalizedPattern, {
      cwd: rootDir,
      nodir: true,
      ignore: ignoreList,
      posix: true,
    });

    return matches;
  }

  public async searchFiles(
    query: string,
    options?: {
      isRegex?: boolean;
      caseSensitive?: boolean;
      filePattern?: string;
      customCwd?: string;
      maxResults?: number;
      project?: string;
    }
  ): Promise<{ matches: SearchMatch[]; totalMatches: number; truncated: boolean; searchedFiles: number; project?: string; projectRoot: string; pattern: string }> {
    const rootDir = this.resolvePath('.', options?.customCwd, options?.project);
    const pattern = options?.filePattern || '**/*';
    const maxResults = options?.maxResults || 100;

    const files = await this.findFiles(pattern, { customCwd: options?.customCwd, project: options?.project });
    const matches: SearchMatch[] = [];

    let regex: RegExp;
    try {
      const flags = options?.caseSensitive ? 'g' : 'gi';
      regex = options?.isRegex ? new RegExp(query, flags) : new RegExp(this.escapeRegExp(query), flags);
    } catch (err: any) {
      throw new Error(`Invalid search regular expression: ${err.message}`);
    }

    for (const relFile of files) {
      if (matches.length >= maxResults) break;

      const fullPath = path.join(rootDir, relFile);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          regex.lastIndex = 0;
          if (regex.test(line)) {
            matches.push({
              file: relFile,
              lineNumber: i + 1,
              lineContent: line.trim(),
            });

            if (matches.length >= maxResults) {
              break;
            }
          }
        }
      } catch {
        // Skip binary or unreadable files
      }
    }

    return {
      matches,
      totalMatches: matches.length,
      truncated: matches.length >= maxResults,
      searchedFiles: files.length,
      project: options?.project,
      projectRoot: rootDir,
      pattern,
    };
  }

  public async searchWithContext(
    query: string,
    options?: {
      contextLines?: number;
      isRegex?: boolean;
      caseSensitive?: boolean;
      filePattern?: string;
      customCwd?: string;
      maxResults?: number;
      project?: string;
    }
  ): Promise<{
    totalMatches: number;
    filesCount: number;
    results: Array<{
      file: string;
      matches: Array<{
        matchLine: number;
        lineContent: string;
        snippet: string;
        startLine: number;
        endLine: number;
      }>;
    }>;
  }> {
    const rootDir = this.resolvePath('.', options?.customCwd, options?.project);
    const pattern = options?.filePattern || '**/*';
    const maxResults = options?.maxResults || 60;
    const contextRadius = options?.contextLines !== undefined ? options.contextLines : 2;

    const files = await this.findFiles(pattern, { customCwd: options?.customCwd, project: options?.project });
    const fileGroupMap = new Map<string, Array<{ matchLine: number; lineContent: string; snippet: string; startLine: number; endLine: number }>>();
    let totalMatches = 0;

    let regex: RegExp;
    try {
      const flags = options?.caseSensitive ? 'g' : 'gi';
      regex = options?.isRegex ? new RegExp(query, flags) : new RegExp(this.escapeRegExp(query), flags);
    } catch (err: any) {
      throw new Error(`Invalid search regular expression: ${err.message}`);
    }

    for (const relFile of files) {
      if (totalMatches >= maxResults) break;

      const fullPath = path.join(rootDir, relFile);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const fileMatches: Array<{ matchLine: number; lineContent: string; snippet: string; startLine: number; endLine: number }> = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          regex.lastIndex = 0;
          if (regex.test(line)) {
            const startLineIdx = Math.max(0, i - contextRadius);
            const endLineIdx = Math.min(lines.length - 1, i + contextRadius);
            const snippet = lines.slice(startLineIdx, endLineIdx + 1).join('\n');

            fileMatches.push({
              matchLine: i + 1,
              lineContent: line.trim(),
              snippet,
              startLine: startLineIdx + 1,
              endLine: endLineIdx + 1,
            });

            totalMatches++;
            if (totalMatches >= maxResults) break;
          }
        }

        if (fileMatches.length > 0) {
          fileGroupMap.set(relFile, fileMatches);
        }
      } catch {
        // skip unreadable files
      }
    }

    const results = Array.from(fileGroupMap.entries()).map(([file, matches]) => ({
      file,
      matches,
    }));

    return {
      totalMatches,
      filesCount: results.length,
      results,
    };
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
