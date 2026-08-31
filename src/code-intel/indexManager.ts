import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { SymbolService, CodeSymbol } from './symbolService.js';

export interface FileIndexEntry {
  path: string;
  mtimeMs: number;
  symbols: CodeSymbol[];
}

export class IndexManager {
  private fileIndex = new Map<string, FileIndexEntry>();
  private symbolService = new SymbolService();

  public async getOrIndexFile(fullPath: string): Promise<CodeSymbol[]> {
    if (!fsSync.existsSync(fullPath)) return [];

    const stat = await fs.stat(fullPath);
    const cached = this.fileIndex.get(fullPath);

    // Dirty-File Overlay: if mtimeMs is identical, return cached symbols
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.symbols;
    }

    const { symbols } = await this.symbolService.listSymbols(fullPath);
    this.fileIndex.set(fullPath, {
      path: fullPath,
      mtimeMs: stat.mtimeMs,
      symbols,
    });

    return symbols;
  }

  public invalidateFile(fullPath: string): void {
    this.fileIndex.delete(fullPath);
  }

  public clear(): void {
    this.fileIndex.clear();
  }
}
