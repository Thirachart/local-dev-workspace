export interface PtyRunOptions {
  executable: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
  timeoutMs?: number;
  env?: Record<string, string>;
  input?: Array<{ afterPattern?: string; send: string }>;
}

export interface PtyRunResult {
  exitCode: number | null;
  transcript: string;
  timedOut: boolean;
  terminal: {
    implementation: 'conpty' | 'unix-pty' | 'pipe-fallback';
    cols: number;
    rows: number;
  };
}

export class PtyRunner {
  public async runPty(options: PtyRunOptions): Promise<PtyRunResult> {
    const cols = options.cols || 120;
    const rows = options.rows || 30;
    const timeoutMs = options.timeoutMs || 30000;
    const isWindows = process.platform === 'win32';

    let nodePty: any;
    try {
      const ptyModule = await import('node-pty');
      nodePty = (ptyModule as any).default || ptyModule;
    } catch {
      nodePty = null;
    }

    if (nodePty && typeof nodePty.spawn === 'function') {
      try {
        return await new Promise<PtyRunResult>((resolve, reject) => {
          let transcript = '';
          let timedOut = false;
          let cleanupRequested = false;

          let ptyProc: any;
          try {
            ptyProc = nodePty.spawn(options.executable, options.args || [], {
              name: 'xterm-256color',
              cols,
              rows,
              cwd: options.cwd || process.cwd(),
              env: { ...process.env, ...options.env, TERM: 'xterm-256color' },
              useConpty: isWindows,
            });
          } catch (spawnErr) {
            return reject(spawnErr);
          }

          // node-pty's Windows ConPTY bridge owns a worker thread for the
          // output pipe. The child can exit without that worker being
          // released. On a normal exit, dispose only that already-exited
          // bridge; calling pty.kill() here makes node-pty spawn its console
          // inspection helper against a process that is already gone.
          const releaseExitedPty = () => {
            try {
              ptyProc._agent?._conoutSocketWorker?.dispose?.();
            } catch {}
          };

          const requestCleanup = () => {
            if (cleanupRequested) return;
            cleanupRequested = true;
            try {
              if (typeof ptyProc.destroy === 'function') {
                ptyProc.destroy();
              } else {
                ptyProc.kill();
              }
            } catch {}
          };

          const timer = setTimeout(() => {
            timedOut = true;
            requestCleanup();
            resolve({
              exitCode: null,
              transcript: cleanAnsi(transcript),
              timedOut: true,
              terminal: {
                implementation: isWindows ? 'conpty' : 'unix-pty',
                cols,
                rows,
              },
            });
          }, timeoutMs);

          ptyProc.onData((data: string) => {
            transcript += data;
            if (options.input && options.input.length > 0) {
              for (let i = 0; i < options.input.length; i++) {
                const rule = options.input[i];
                if (!rule.afterPattern || transcript.includes(rule.afterPattern)) {
                  ptyProc.write(rule.send);
                  options.input.splice(i, 1);
                  i--;
                }
              }
            }
          });

          ptyProc.onExit((event: { exitCode: number }) => {
            clearTimeout(timer);
            releaseExitedPty();
            if (!timedOut) {
              resolve({
                exitCode: event.exitCode,
                transcript: cleanAnsi(transcript),
                timedOut: false,
                terminal: {
                  implementation: isWindows ? 'conpty' : 'unix-pty',
                  cols,
                  rows,
                },
              });
            }
          });
        });
      } catch {
        // Fallback to pipe runner below if nodePty fails to spawn
      }
    }

    // Fallback if node-pty is unavailable
    const { spawn } = await import('node:child_process');
    return new Promise<PtyRunResult>((resolve) => {
      let transcript = '';
      let timedOut = false;

      const child = spawn(options.executable, options.args || [], {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        shell: isWindows ? 'powershell.exe' : '/bin/bash',
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        resolve({
          exitCode: null,
          transcript,
          timedOut: true,
          terminal: { implementation: 'pipe-fallback', cols, rows },
        });
      }, timeoutMs);

      child.stdout?.on('data', (d) => (transcript += d.toString()));
      child.stderr?.on('data', (d) => (transcript += d.toString()));

      if (!options.input || options.input.length === 0) {
        try { child.stdin?.end(); } catch {}
      }

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        if (!timedOut) {
          resolve({
            exitCode,
            transcript: cleanAnsi(transcript),
            timedOut: false,
            terminal: { implementation: 'pipe-fallback', cols, rows },
          });
        }
      });
    });
  }
}

function cleanAnsi(str: string): string {
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}
