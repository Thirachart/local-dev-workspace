export interface DiagnosticItem {
  severity: 'error' | 'warning';
  tool: 'msbuild' | 'csc' | 'tsc' | 'vue-tsc' | 'vitest' | 'dotnet' | 'eslint' | 'other';
  code?: string;
  path?: string;
  line?: number;
  column?: number;
  message: string;
}

export interface CompactDiagnosticsResult {
  passed: boolean;
  errors: DiagnosticItem[];
  warnings: DiagnosticItem[];
  unparsedRelevantLines: string[];
  summary: {
    errorCount: number;
    warningCount: number;
  };
  command: string;
  exitCode: number;
}

export class DiagnosticParser {
  public parseOutput(
    rawOutput: string,
    command: string,
    exitCode: number
  ): CompactDiagnosticsResult {
    const errors: DiagnosticItem[] = [];
    const warnings: DiagnosticItem[] = [];
    const unparsedRelevantLines: string[] = [];

    const lines = rawOutput.split(/\r?\n/);
    const msbuildRegex = /^(.*?)\((\d+),(\d+)\):\s+(error|warning)\s+([A-Z0-9]+):\s+(.*)$/i;
    const tscRegex = /^(.*?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/i;
    const tscAltRegex = /^(.*?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.*)$/i;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let matched = false;

      // 1. MSBuild / CSC
      const mbMatch = trimmed.match(msbuildRegex);
      if (mbMatch) {
        matched = true;
        const item: DiagnosticItem = {
          path: mbMatch[1],
          line: parseInt(mbMatch[2], 10),
          column: parseInt(mbMatch[3], 10),
          severity: mbMatch[4].toLowerCase() === 'error' ? 'error' : 'warning',
          code: mbMatch[5],
          message: mbMatch[6],
          tool: 'msbuild',
        };
        if (item.severity === 'error') errors.push(item);
        else warnings.push(item);
      }

      // 2. TypeScript / vue-tsc
      if (!matched) {
        const tsMatch = trimmed.match(tscRegex) || trimmed.match(tscAltRegex);
        if (tsMatch) {
          matched = true;
          const item: DiagnosticItem = {
            path: tsMatch[1],
            line: parseInt(tsMatch[2], 10),
            column: parseInt(tsMatch[3], 10),
            severity: tsMatch[4].toLowerCase() === 'error' ? 'error' : 'warning',
            code: tsMatch[5],
            message: tsMatch[6],
            tool: 'tsc',
          };
          if (item.severity === 'error') errors.push(item);
          else warnings.push(item);
        }
      }

      // 3. Unparsed Relevant Lines Capture (Never swallow errors silently)
      if (!matched) {
        const lower = trimmed.toLowerCase();
        if (
          lower.includes('error') ||
          lower.includes('failed') ||
          lower.includes('exception') ||
          lower.includes('fatal') ||
          lower.includes('cannot find') ||
          lower.includes('undefined')
        ) {
          unparsedRelevantLines.push(trimmed);
        }
      }
    }

    // STRICT CONTRACT: If exitCode !== 0 and zero parsed diagnostics found,
    // unparsedRelevantLines MUST NOT be empty so toolchain errors are never swallowed.
    if (exitCode !== 0 && errors.length === 0) {
      if (unparsedRelevantLines.length === 0) {
        // Take top non-empty lines from raw output
        const nonEmpties = lines.map(l => l.trim()).filter(Boolean);
        unparsedRelevantLines.push(...nonEmpties.slice(0, 15));
        if (unparsedRelevantLines.length === 0) {
          unparsedRelevantLines.push(`[EXECUTION_FAILURE] Process exited with code ${exitCode} without stdout/stderr output.`);
        }
      }
    }

    return {
      passed: exitCode === 0 && errors.length === 0,
      errors,
      warnings,
      unparsedRelevantLines: unparsedRelevantLines.slice(0, 30),
      summary: {
        errorCount: errors.length,
        warningCount: warnings.length,
      },
      command,
      exitCode,
    };
  }
}
