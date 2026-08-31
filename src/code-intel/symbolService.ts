import ts from 'typescript';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { VueSfcParser } from './vueSfcAst.js';

export interface CodeSymbol {
  name: string;
  kind: 'class' | 'interface' | 'function' | 'method' | 'property' | 'enum' | 'type' | 'component';
  startLine: number;
  endLine: number;
  signature?: string;
  parent?: string;
}

export class SymbolService {
  private vueParser = new VueSfcParser();

  public async listSymbols(fullPath: string): Promise<{ symbols: CodeSymbol[]; parser: string }> {
    if (!fsSync.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    const ext = path.extname(fullPath).toLowerCase();

    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      const symbols = this.extractTsSymbols(content, fullPath);
      return { symbols, parser: 'typescript-ast' };
    }

    if (ext === '.vue') {
      const extracted = this.vueParser.extractScript(content, path.basename(fullPath));
      const combined = `${extracted.scriptContent}\n${extracted.scriptSetupContent}`;
      const symbols = this.extractTsSymbols(combined, fullPath);
      return { symbols, parser: 'vue-sfc-ast' };
    }

    // Fallback for C# and other languages
    const symbols = this.extractRegexSymbols(content);
    return { symbols, parser: 'text-fallback' };
  }

  public async readSymbol(
    fullPath: string,
    symbolName: string
  ): Promise<{ symbol: CodeSymbol; source: string; parser: string }> {
    const { symbols, parser } = await this.listSymbols(fullPath);
    const matched = symbols.filter(s => s.name === symbolName || s.name.endsWith(`.${symbolName}`));

    if (matched.length === 0) {
      const err: any = new Error(`[SYMBOL_NOT_FOUND] Symbol "${symbolName}" not found in "${fullPath}".`);
      err.category = 'validation';
      err.code = 'SYMBOL_NOT_FOUND';
      throw err;
    }

    if (matched.length > 1) {
      const err: any = new Error(`[AMBIGUOUS_MATCH] Multiple symbols matched "${symbolName}".`);
      err.category = 'validation';
      err.code = 'AMBIGUOUS_MATCH';
      err.details = { candidates: matched };
      throw err;
    }

    const symbol = matched[0];
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const source = lines.slice(symbol.startLine - 1, symbol.endLine).join('\n');

    return { symbol, source, parser };
  }

  private extractTsSymbols(content: string, filename: string): CodeSymbol[] {
    const sourceFile = ts.createSourceFile(
      filename,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const symbols: CodeSymbol[] = [];

    const visit = (node: ts.Node, parentName?: string) => {
      let currentParent = parentName;

      if (ts.isClassDeclaration(node) && node.name) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        symbols.push({
          name: node.name.text,
          kind: 'class',
          startLine: start.line + 1,
          endLine: end.line + 1,
          signature: `class ${node.name.text}`,
          parent: parentName,
        });
        currentParent = node.name.text;
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        symbols.push({
          name: node.name.text,
          kind: 'interface',
          startLine: start.line + 1,
          endLine: end.line + 1,
          signature: `interface ${node.name.text}`,
          parent: parentName,
        });
        currentParent = node.name.text;
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        symbols.push({
          name: node.name.text,
          kind: 'function',
          startLine: start.line + 1,
          endLine: end.line + 1,
          signature: `function ${node.name.text}(...)`,
          parent: parentName,
        });
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        symbols.push({
          name: node.name.text,
          kind: 'method',
          startLine: start.line + 1,
          endLine: end.line + 1,
          signature: `${node.name.text}(...)`,
          parent: parentName,
        });
      }

      ts.forEachChild(node, child => visit(child, currentParent));
    };

    visit(sourceFile);
    return symbols;
  }

  private extractRegexSymbols(content: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/(?:public|private|protected|internal)?\s*(?:static|async|override|virtual)?\s*(?:class|interface|record)\s+([A-Za-z0-9_]+)/);
      if (match) {
        symbols.push({
          name: match[1],
          kind: 'class',
          startLine: i + 1,
          endLine: Math.min(i + 30, lines.length),
          signature: match[0].trim(),
        });
      }
    }
    return symbols;
  }
}
