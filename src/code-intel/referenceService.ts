import ts from 'typescript';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TypeScriptProgramManager } from './typescriptProgram.js';

export interface ReferenceResult {
  filePath: string;
  line: number;
  column: number;
  context: string;
  kind: 'definition' | 'call' | 'read' | 'write' | 'type-reference' | 'import';
  semantic: boolean;
  confidence: 'high' | 'medium' | 'low';
  engine: 'typescript-checker' | 'text-fallback';
  limitations?: string[];
}

export class ReferenceService {
  constructor(private readonly tsManager = new TypeScriptProgramManager()) {}

  public async findReferences(rootDir: string, symbolName: string, maxResults = 100): Promise<{
    symbol: string;
    totalHits: number;
    references: Array<ReferenceResult & { path: string }>;
  }> {
    const { glob } = await import('glob');
    const relFiles = await glob('**/*.{ts,tsx,js,jsx,cs,vue,py}', {
      cwd: rootDir,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/bin/**', '**/obj/**'],
    });
    const files = relFiles.map((file) => path.resolve(rootDir, file));
    const references = await this.findReferencesInFiles(symbolName, files, maxResults);
    return {
      symbol: symbolName,
      totalHits: references.length,
      references: references.map((reference) => ({
        ...reference,
        path: path.relative(rootDir, reference.filePath).replace(/\\/g, '/'),
      })),
    };
  }

  public async findReferencesInFiles(symbolName: string, files: string[], maxResults = 100): Promise<ReferenceResult[]> {
    const tsFiles = files.filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
    const otherFiles = files.filter((file) => !/\.(ts|tsx|js|jsx)$/.test(file));
    const results: ReferenceResult[] = [];

    if (tsFiles.length) {
      const semantic = this.findSemanticTypeScriptReferences(symbolName, tsFiles, maxResults);
      if (semantic.length) {
        results.push(...semantic);
      } else {
        const fallback = await this.findTextReferences(symbolName, tsFiles, maxResults, [
          'Symbol could not be resolved to one unique compiler declaration; results are text matches only.',
        ]);
        results.push(...fallback);
      }
    }

    if (results.length < maxResults && otherFiles.length) {
      const fallback = await this.findTextReferences(symbolName, otherFiles, maxResults - results.length, [
        'No semantic language service is configured for this file type.',
      ]);
      results.push(...fallback);
    }

    return results.slice(0, maxResults);
  }

  private findSemanticTypeScriptReferences(symbolName: string, files: string[], maxResults: number): ReferenceResult[] {
    let context: ReturnType<TypeScriptProgramManager['getProgramForFile']>;
    try {
      context = this.tsManager.getProgramForFile(files[0]);
    } catch {
      return [];
    }

    const { program, checker } = context;
    const programFiles = new Set(program.getSourceFiles().map((source) => path.resolve(source.fileName)));
    if (files.some((file) => !programFiles.has(path.resolve(file)))) {
      // A partial Program cannot make a completeness claim across the requested file set.
      return [];
    }

    const canonical = (symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
      if (!symbol) return undefined;
      return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    };

    const declarationSymbols = new Set<ts.Symbol>();
    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile) continue;
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && node.text === symbolName && this.isDeclarationIdentifier(node)) {
          const symbol = canonical(checker.getSymbolAtLocation(node));
          if (symbol) declarationSymbols.add(symbol);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    // Without a unique compiler-resolved declaration, do not claim semantic certainty.
    if (declarationSymbols.size !== 1) {
      return [];
    }
    const [targetSymbol] = [...declarationSymbols];
    const results: ReferenceResult[] = [];

    for (const file of files) {
      const source = program.getSourceFile(path.resolve(file)) || program.getSourceFile(file);
      if (!source) continue;

      const visit = (node: ts.Node) => {
        if (results.length >= maxResults) return;
        if (ts.isIdentifier(node) && node.text === symbolName) {
          const symbol = canonical(checker.getSymbolAtLocation(node));
          if (symbol === targetSymbol) {
            const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
            const lineText = source.text.split(/\r?\n/)[line] ?? '';
            results.push({
              filePath: source.fileName,
              line: line + 1,
              column: character + 1,
              context: lineText.trim(),
              kind: this.classifyKind(node),
              semantic: true,
              confidence: 'high',
              engine: 'typescript-checker',
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    return results;
  }

  public async findTextReferences(
    symbolName: string,
    files: string[],
    maxResults = 100,
    limitations: string[] = ['Symbol could not be resolved to a unique semantic declaration.']
  ): Promise<ReferenceResult[]> {
    const results: ReferenceResult[] = [];
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');

    for (const file of files) {
      if (results.length >= maxResults) break;
      try {
        const content = await fs.readFile(file, 'utf8');
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          regex.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = regex.exec(lines[i])) && results.length < maxResults) {
            results.push({
              filePath: file,
              line: i + 1,
              column: match.index + 1,
              context: lines[i].trim(),
              kind: 'read',
              semantic: false,
              confidence: 'low',
              engine: 'text-fallback',
              limitations,
            });
          }
        }
      } catch {
        // Skip unreadable files; caller can inspect missing coverage separately.
      }
    }
    return results;
  }

  private isDeclarationIdentifier(node: ts.Identifier): boolean {
    const parent = node.parent;
    return (
      (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isFunctionDeclaration(parent) ||
       ts.isMethodDeclaration(parent) || ts.isVariableDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
       ts.isEnumDeclaration(parent)) && parent.name === node
    );
  }

  private classifyKind(node: ts.Identifier): ReferenceResult['kind'] {
    const parent = node.parent;
    if (this.isDeclarationIdentifier(node)) return 'definition';
    if (ts.isCallExpression(parent) && parent.expression === node) return 'call';
    if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) return 'import';
    if (ts.isTypeReferenceNode(parent)) return 'type-reference';
    if (ts.isBinaryExpression(parent) && parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return 'write';
    return 'read';
  }
}
