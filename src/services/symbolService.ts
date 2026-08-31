import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse as parseVueSfc } from '@vue/compiler-sfc';
import { ProjectService } from './projectService.js';
import { ReferenceService } from '../code-intel/referenceService.js';

export interface CodeSymbol {
  name: string;
  kind: 'class' | 'interface' | 'method' | 'function' | 'enum' | 'struct' | 'type' | 'property';
  containerName?: string;
  startLine: number;
  endLine: number;
  signature: string;
  docstring?: string;
}

export interface SymbolDetail extends CodeSymbol {
  content: string;
  totalLines: number;
}

export class SymbolService {
  private baseDir: string;
  private projectService?: ProjectService;

  constructor(baseDir: string = process.cwd(), projectService?: ProjectService) {
    this.baseDir = path.resolve(baseDir);
    this.projectService = projectService;
  }

  private resolvePath(targetPath: string, customCwd?: string, projectName?: string): { fullPath: string; relPath: string } {
    let resolvedBase = this.baseDir;
    if (this.projectService) {
      resolvedBase = this.projectService.resolveWorkingDir(customCwd, projectName);
    } else if (customCwd) {
      resolvedBase = path.isAbsolute(customCwd) ? path.resolve(customCwd) : path.resolve(this.baseDir, customCwd);
    }

    const fullPath = path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(resolvedBase, targetPath);
    const relPath = path.relative(resolvedBase, fullPath).replace(/\\/g, '/');

    // Path Jail Security check
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) {
      throw new Error(`Access Denied: Path "${targetPath}" escapes project workspace.`);
    }

    return { fullPath, relPath };
  }

  public async listSymbols(
    targetPath: string,
    options?: { customCwd?: string; project?: string }
  ): Promise<{
    filePath: string;
    totalSymbols: number;
    parser: 'typescript-ast' | 'vue-sfc-ast' | 'csharp-grammar' | 'python-ast' | 'generic';
    symbols: CodeSymbol[];
  }> {
    const { fullPath, relPath } = this.resolvePath(targetPath, options?.customCwd, options?.project);
    if (!fsSync.existsSync(fullPath)) {
      throw new Error(`Target file does not exist: "${relPath}"`);
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    const ext = path.extname(fullPath).toLowerCase();
    const result = this.parseSymbols(content, ext, relPath);

    return {
      filePath: relPath,
      totalSymbols: result.symbols.length,
      parser: result.parser,
      symbols: result.symbols,
    };
  }

  public async readSymbol(
    targetPath: string,
    symbolName: string,
    options?: { customCwd?: string; project?: string }
  ): Promise<{
    filePath: string;
    found: boolean;
    symbol: SymbolDetail;
  }> {
    const { fullPath, relPath } = this.resolvePath(targetPath, options?.customCwd, options?.project);
    if (!fsSync.existsSync(fullPath)) {
      throw new Error(`Target file does not exist: "${relPath}"`);
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    const ext = path.extname(fullPath).toLowerCase();
    const result = this.parseSymbols(content, ext, relPath);

    const cleanTargetName = symbolName.trim();
    const matched = result.symbols.find(
      (s) =>
        s.name.toLowerCase() === cleanTargetName.toLowerCase() ||
        (s.containerName && `${s.containerName}.${s.name}`.toLowerCase() === cleanTargetName.toLowerCase())
    );

    if (!matched) {
      const availableNames = result.symbols.slice(0, 20).map((s) => s.name).join(', ');
      throw new Error(
        `Symbol "${symbolName}" not found in "${relPath}". Available symbols: [${availableNames || 'None'}]`
      );
    }

    const lines = content.split(/\r?\n/);
    const startIdx = Math.max(0, matched.startLine - 1);
    const endIdx = Math.min(lines.length, matched.endLine);
    const symbolCode = lines.slice(startIdx, endIdx).join('\n');

    return {
      filePath: relPath,
      found: true,
      symbol: {
        ...matched,
        content: symbolCode,
        totalLines: endIdx - startIdx,
      },
    };
  }

  public async findReferences(
    symbolName: string,
    options?: {
      customCwd?: string;
      project?: string;
      filePattern?: string;
      maxResults?: number;
      maxFiles?: number;
      timeoutMs?: number;
    }
  ): Promise<{
    symbolName: string;
    totalMatches: number;
    filesScanned: number;
    scanLimit: number;
    truncated: boolean;
    references: Array<{
      filePath: string;
      line: number;
      column: number;
      lineContent: string;
      isDeclaration: boolean;
      semantic: boolean;
      confidence: 'high' | 'medium' | 'low';
      engine: 'typescript-checker' | 'text-fallback';
      limitations?: string[];
    }>;
  }> {
    const { globIterate } = await import('glob');
    let resolvedBase = this.baseDir;
    if (this.projectService) {
      resolvedBase = this.projectService.resolveWorkingDir(options?.customCwd, options?.project);
    } else if (options?.customCwd) {
      resolvedBase = path.isAbsolute(options.customCwd) ? path.resolve(options.customCwd) : path.resolve(this.baseDir, options.customCwd);
    }

    const cleanSymbol = symbolName.trim();
    const pattern = options?.filePattern || '**/*.{cs,ts,tsx,js,jsx,vue,py}';
    const scanLimit = Math.max(1, Math.min(options?.maxFiles || 1_000, 10_000));
    const timeoutMs = Math.max(1_000, Math.min(options?.timeoutMs || 10_000, 30_000));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const relFiles: string[] = [];
    let truncated = false;
    try {
      for await (const file of globIterate(pattern, {
        cwd: resolvedBase,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/.git/**'],
        signal: controller.signal,
      })) {
        if (relFiles.length >= scanLimit) {
          truncated = true;
          break;
        }
        relFiles.push(file);
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        throw new Error(`Reference file discovery timed out after ${timeoutMs}ms. Narrow file_pattern or cwd.`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    const fullFiles = relFiles.map((file) => path.resolve(resolvedBase, file));
    const service = new ReferenceService();
    const found = await service.findReferencesInFiles(cleanSymbol, fullFiles, options?.maxResults || 50);

    return {
      symbolName: cleanSymbol,
      totalMatches: found.length,
      filesScanned: relFiles.length,
      scanLimit,
      truncated,
      references: found.map((ref) => ({
        filePath: path.relative(resolvedBase, ref.filePath).replace(/\\/g, '/'),
        line: ref.line,
        column: ref.column,
        lineContent: ref.context,
        isDeclaration: ref.kind === 'definition',
        semantic: ref.semantic,
        confidence: ref.confidence,
        engine: ref.engine,
        limitations: ref.limitations,
      })),
    };
  }

  private parseSymbols(
    content: string,
    ext: string,
    fileName: string
  ): { parser: 'typescript-ast' | 'vue-sfc-ast' | 'csharp-grammar' | 'python-ast' | 'generic'; symbols: CodeSymbol[] } {
    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      return { parser: 'typescript-ast', symbols: this.parseTypeScriptAst(content, fileName) };
    } else if (ext === '.vue') {
      return { parser: 'vue-sfc-ast', symbols: this.parseVueSfc(content, fileName) };
    } else if (ext === '.cs') {
      return { parser: 'csharp-grammar', symbols: this.parseCSharpSymbols(content) };
    } else if (ext === '.py') {
      return { parser: 'python-ast', symbols: this.parsePythonSymbols(content) };
    }
    return { parser: 'generic', symbols: this.parseGenericSymbols(content) };
  }

  private parseTypeScriptAst(sourceText: string, fileName: string, lineOffset: number = 0): CodeSymbol[] {
    const sourceFile = ts.createSourceFile(
      fileName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    const symbols: CodeSymbol[] = [];

    const visit = (node: ts.Node, currentContainer?: string) => {
      let nodeContainer = currentContainer;

      if (ts.isClassDeclaration(node) && node.name) {
        const name = node.name.text;
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        symbols.push({
          name,
          kind: 'class',
          startLine: startLine + 1 + lineOffset,
          endLine: endLine + 1 + lineOffset,
          signature: sourceText.slice(node.getStart(sourceFile), node.name.end).trim(),
        });
        nodeContainer = name;
      } else if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.text;
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        symbols.push({
          name,
          kind: 'interface',
          startLine: startLine + 1 + lineOffset,
          endLine: endLine + 1 + lineOffset,
          signature: sourceText.slice(node.getStart(sourceFile), node.name.end).trim(),
        });
      } else if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text;
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        symbols.push({
          name,
          kind: 'type',
          startLine: startLine + 1 + lineOffset,
          endLine: endLine + 1 + lineOffset,
          signature: `type ${name}`,
        });
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const name = node.name.text;
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        symbols.push({
          name,
          kind: 'function',
          containerName: currentContainer,
          startLine: startLine + 1 + lineOffset,
          endLine: endLine + 1 + lineOffset,
          signature: sourceText.slice(node.getStart(sourceFile), (node.body?.pos ?? node.end)).trim(),
        });
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        const name = node.name.text;
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        symbols.push({
          name,
          kind: 'method',
          containerName: currentContainer,
          startLine: startLine + 1 + lineOffset,
          endLine: endLine + 1 + lineOffset,
          signature: sourceText.slice(node.getStart(sourceFile), (node.body?.pos ?? node.end)).trim(),
        });
      }

      ts.forEachChild(node, (child) => visit(child, nodeContainer));
    };

    visit(sourceFile);
    return symbols;
  }

  private parseVueSfc(content: string, fileName: string): CodeSymbol[] {
    try {
      const parsed = parseVueSfc(content);
      const symbols: CodeSymbol[] = [];

      if (parsed.descriptor.script) {
        const scriptCode = parsed.descriptor.script.content;
        const lineOffset = parsed.descriptor.script.loc.start.line - 1;
        symbols.push(...this.parseTypeScriptAst(scriptCode, `${fileName}.ts`, lineOffset));
      }

      if (parsed.descriptor.scriptSetup) {
        const scriptCode = parsed.descriptor.scriptSetup.content;
        const lineOffset = parsed.descriptor.scriptSetup.loc.start.line - 1;
        symbols.push(...this.parseTypeScriptAst(scriptCode, `${fileName}.ts`, lineOffset));
      }

      return symbols;
    } catch {
      return this.parseTypeScriptAst(content, `${fileName}.ts`);
    }
  }

  private parseCSharpSymbols(content: string): CodeSymbol[] {
    const lines = content.split(/\r?\n/);
    const symbols: CodeSymbol[] = [];
    let currentContainer: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      // Class / Interface / Record / Struct / Enum
      const typeMatch = trimmed.match(
        /^(?:public|private|protected|internal|static|abstract|sealed|partial|\s)*(?:class|interface|record|struct|enum)\s+([A-Za-z0-9_]+)/
      );
      if (typeMatch) {
        const name = typeMatch[1];
        const kind = trimmed.includes('interface ')
          ? 'interface'
          : trimmed.includes('enum ')
          ? 'enum'
          : trimmed.includes('struct ')
          ? 'struct'
          : 'class';
        const endLine = this.findMatchingClosingBrace(lines, i);
        symbols.push({
          name,
          kind,
          startLine: i + 1,
          endLine,
          signature: trimmed.replace(/\{.*$/, '').trim(),
        });
        currentContainer = name;
        continue;
      }

      // Methods / Constructors
      const methodMatch = trimmed.match(
        /^(?:public|private|protected|internal|static|async|override|virtual|abstract|\s)*([A-Za-z0-9_<>?, ]+)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/
      );
      if (methodMatch && !trimmed.startsWith('if') && !trimmed.startsWith('while') && !trimmed.startsWith('for') && !trimmed.startsWith('switch')) {
        const methodName = methodMatch[2];
        const endLine = this.findMatchingClosingBrace(lines, i);
        symbols.push({
          name: methodName,
          kind: 'method',
          containerName: currentContainer,
          startLine: i + 1,
          endLine,
          signature: trimmed.replace(/\{.*$/, '').trim(),
        });
      }
    }

    return symbols;
  }

  private parsePythonSymbols(content: string): CodeSymbol[] {
    const lines = content.split(/\r?\n/);
    const symbols: CodeSymbol[] = [];
    let currentClass: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const indent = line.length - line.trimStart().length;
      const trimmed = line.trim();

      if (trimmed.startsWith('class ')) {
        const match = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
        if (match) {
          const name = match[1];
          const endLine = this.findPythonBlockEnd(lines, i, indent);
          symbols.push({
            name,
            kind: 'class',
            startLine: i + 1,
            endLine,
            signature: this.extractPythonSignature(lines, i),
          });
          currentClass = name;
        }
      } else if (/^(?:async\s+)?def\s+/.test(trimmed)) {
        const match = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z0-9_]+)/);
        if (match) {
          const name = match[1];
          const endLine = this.findPythonBlockEnd(lines, i, indent);
          symbols.push({
            name,
            kind: indent > 0 ? 'method' : 'function',
            containerName: indent > 0 ? currentClass : undefined,
            startLine: i + 1,
            endLine,
            signature: this.extractPythonSignature(lines, i),
          });
        }
      }
    }

    return symbols;
  }

  private extractPythonSignature(lines: string[], startIndex: number): string {
    const parts: string[] = [];
    let bracketDepth = 0;
    let quote: "'" | '"' | undefined;
    let escaped = false;

    for (let i = startIndex; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      for (let j = 0; j < trimmed.length; j++) {
        const ch = trimmed[j];

        if (quote) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === '\\') {
            escaped = true;
            continue;
          }
          if (ch === quote) quote = undefined;
          continue;
        }

        if (ch === "'" || ch === '"') {
          quote = ch;
          continue;
        }
        if (ch === '#') break;
        if (ch === '(' || ch === '[' || ch === '{') {
          bracketDepth++;
          continue;
        }
        if (ch === ')' || ch === ']' || ch === '}') {
          bracketDepth--;
          continue;
        }
        if (ch === ':' && bracketDepth === 0) {
          parts.push(trimmed.slice(0, j).trimEnd());
          return parts.join(' ').trim();
        }
      }

      parts.push(trimmed);
    }

    return parts.join(' ').trim();
  }
  private parseGenericSymbols(content: string): CodeSymbol[] {
    const lines = content.split(/\r?\n/);
    const symbols: CodeSymbol[] = [];
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const match = trimmed.match(/^(?:function|class|def|type|struct)\s+([A-Za-z0-9_]+)/);
      if (match) {
        symbols.push({
          name: match[1],
          kind: 'function',
          startLine: i + 1,
          endLine: Math.min(lines.length, i + 20),
          signature: trimmed,
        });
      }
    }
    return symbols;
  }

  private findMatchingClosingBrace(lines: string[], startLineIdx: number): number {
    let braceCount = 0;
    let foundOpenBrace = false;

    for (let i = startLineIdx; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        } else if (char === '}') {
          braceCount--;
          if (foundOpenBrace && braceCount === 0) {
            return i + 1;
          }
        }
      }
    }

    return Math.min(lines.length, startLineIdx + 50);
  }

  private findPythonBlockEnd(lines: string[], startLineIdx: number, baseIndent: number): number {
    let declarationEndIdx = startLineIdx;
    let bracketDepth = 0;

    for (let i = startLineIdx; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      for (const ch of trimmed) {
        if (ch === '(' || ch === '[' || ch === '{') bracketDepth++;
        else if (ch === ')' || ch === ']' || ch === '}') bracketDepth--;
      }

      declarationEndIdx = i;
      if (bracketDepth <= 0 && trimmed.includes(':')) break;
    }

    for (let i = declarationEndIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const currentIndent = line.length - line.trimStart().length;
      if (currentIndent <= baseIndent) {
        return i;
      }
    }
    return lines.length;
  }
}
