import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface TypeScriptProgramContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  configPath: string | null;
  fingerprint: string;
}

export class TypeScriptProgramManager {
  private cache = new Map<string, TypeScriptProgramContext>();

  public getProgramForFile(filePath: string): TypeScriptProgramContext {
    const absolute = path.resolve(filePath);
    const configPath = ts.findConfigFile(path.dirname(absolute), ts.sys.fileExists, 'tsconfig.json');
    const cacheKey = configPath || path.dirname(absolute);
    const next = this.createContext(absolute, configPath || null);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.fingerprint === next.fingerprint) return cached;
    this.cache.set(cacheKey, next);
    return next;
  }

  public invalidate(fileOrConfigPath?: string): void {
    if (!fileOrConfigPath) {
      this.cache.clear();
      return;
    }
    const absolute = path.resolve(fileOrConfigPath);
    for (const [key, value] of this.cache) {
      if (key === absolute || value.configPath === absolute || value.program.getSourceFile(absolute)) {
        this.cache.delete(key);
      }
    }
  }

  private createContext(filePath: string, configPath: string | null): TypeScriptProgramContext {
    let rootNames: string[];
    let options: ts.CompilerOptions;
    let configBytes = '';

    if (configPath && fs.existsSync(configPath)) {
      configBytes = fs.readFileSync(configPath, 'utf8');
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      if (read.error) throw new Error(this.formatDiagnostic(read.error));
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
      if (parsed.errors.length) throw new Error(parsed.errors.map((d) => this.formatDiagnostic(d)).join('\n'));
      rootNames = parsed.fileNames;
      options = parsed.options;
    } else {
      rootNames = [filePath];
      options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
    }

    if (!rootNames.includes(filePath) && fs.existsSync(filePath)) rootNames.push(filePath);
    rootNames = [...new Set(rootNames.map((name) => path.resolve(name)))].sort();

    const structuralFingerprint = crypto.createHash('sha256');
    structuralFingerprint.update(configPath || 'no-tsconfig');
    structuralFingerprint.update('\0');
    structuralFingerprint.update(configBytes);
    structuralFingerprint.update('\0');
    structuralFingerprint.update(JSON.stringify(options));
    for (const root of rootNames) {
      structuralFingerprint.update('\0');
      structuralFingerprint.update(root);
      try {
        const stat = fs.statSync(root);
        structuralFingerprint.update(`:${stat.size}:${stat.mtimeMs}`);
      } catch {
        structuralFingerprint.update(':missing');
      }
    }

    const program = ts.createProgram({ rootNames, options });
    const checker = program.getTypeChecker();
    return {
      program,
      checker,
      configPath,
      fingerprint: structuralFingerprint.digest('hex'),
    };
  }

  private formatDiagnostic(diagnostic: ts.Diagnostic): string {
    return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  }
}
