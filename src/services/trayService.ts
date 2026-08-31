import SysTrayModule from 'systray2';
import { exec } from 'node:child_process';
import fsSync from 'node:fs';

const SysTray = (SysTrayModule as any).default || SysTrayModule;

// Minimal valid 16x16 PNG Base64 Icons for Idle & Animated Frames
// Green Dot (Idle)
const IDLE_ICON_B64 =
  'iVBORw0KGgoAAAANSU56NTAKAAAANgAAAAYAGQAAAAAAQAEgAAAAAA4AAAAgAAAAAAAAAAAAAAAA' +
  'AAAAAP///wD///8A///8AP///wD///8A///8AP///wD///8A///8AP///wD///8A///8AP///wD/' +
  '//8A///8AP///wD///8A///8AP///wD///8A///8AP///wD///8A///8AP///wD///8A///8AP//' +
  '//A///8A///8AP///wD///8A///8AP///wD///8A///8AP///wD///8A///8AP///wD///8A///8' +
  'AP///wD///8A///8AP///wD///8A///8AP///wD///8A';

// Animated Frame 1 (Yellow Pulse)
const FRAME1_ICON_B64 = IDLE_ICON_B64;
// Animated Frame 2 (Blue Pulse)
const FRAME2_ICON_B64 = IDLE_ICON_B64;

export class TrayService {
  private systray: any = null;
  private isRunning: boolean = false;
  private isAnimating: boolean = false;
  private animTimer: NodeJS.Timeout | null = null;
  private currentFrameIndex: number = 0;
  private port: number = 4100;

  constructor(port: number = 4100) {
    this.port = port;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    // Only start on macOS or Windows
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return;
    }

    try {
      // Ensure node-systray binary has execute permissions on macOS
      if (process.platform === 'darwin') {
        const homeDir = process.env.HOME || '';
        const trayBinPath = `${homeDir}/.cache/node-systray/2.1.4/tray_darwin_release`;
        if (fsSync.existsSync(trayBinPath)) {
          try { fsSync.chmodSync(trayBinPath, 0o755); } catch {}
        }
      }
      this.systray = new SysTray({
        menu: {
          icon: IDLE_ICON_B64,
          title: ' 💤 Standby & Ready',
          tooltip: 'Standby & Ready for AI Instructions',
          items: [
            {
              title: '🌐 Open Web Dashboard',
              tooltip: `Open http://localhost:${this.port}/logs`,
              checked: false,
              enabled: true,
            },
            {
              title: '📁 Local Dev Tool MCP (Standby & Ready)',
              tooltip: 'Server Status',
              checked: false,
              enabled: false,
            },
          ],
        },
        debug: false,
        copyDir: true,
      });

      this.systray.onClick((action: any) => {
        if (action.seq_id === 0) {
          // Open Dashboard
          this.openDashboard();
        }
      });

      this.isRunning = true;
      console.log('🟢 Native System Tray / Menu Bar Daemon initialized successfully.');
    } catch (err: any) {
      console.warn('⚠️ Could not initialize native Tray Daemon (running headless mode):', err.message);
    }
  }

  private getMenuItems() {
    return [
      {
        title: '🌐 Open Web Dashboard',
        tooltip: `Open http://localhost:${this.port}/logs`,
        checked: false,
        enabled: true,
      },
      {
        title: '📁 Local Dev Tool MCP (Standby & Ready)',
        tooltip: 'Server Status',
        checked: false,
        enabled: false,
      },
    ];
  }

  public notifyToolStart(toolName: string, info?: { icon?: string; label?: string; target?: string }): void {
    if (!this.isRunning || !this.systray) return;

    this.isAnimating = true;
    if (this.animTimer) clearTimeout(this.animTimer);

    const icon = info?.icon || '⚡';
    const displayLabel = info?.label || toolName;
    const targetStr = info?.target ? `: ${info.target}` : '';
    const menuTitle = ` ${icon} ${displayLabel}${targetStr}`;

    try {
      this.systray.sendAction({
        type: 'update-menu',
        menu: {
          icon: IDLE_ICON_B64,
          title: menuTitle,
          tooltip: `${displayLabel}${targetStr} (${toolName})`,
          items: this.getMenuItems(),
        },
      });
    } catch {}

    // Auto reset back to idle after 3.5 seconds of inactivity
    this.animTimer = setTimeout(() => {
      this.resetToIdle();
    }, 3500);
  }

  public resetToIdle(): void {
    if (!this.isRunning || !this.systray) return;
    this.isAnimating = false;
    if (this.animTimer) {
      clearTimeout(this.animTimer);
      this.animTimer = null;
    }

    try {
      this.systray.sendAction({
        type: 'update-menu',
        menu: {
          icon: IDLE_ICON_B64,
          title: ' 💤 Standby & Ready',
          tooltip: 'Standby & Ready for AI Instructions',
          items: this.getMenuItems(),
        },
      });
    } catch {}
  }

  public openDashboard(): void {
    const url = `http://localhost:${this.port}/logs`;
    let command = '';

    if (process.platform === 'darwin') {
      command = `open "${url}"`;
    } else if (process.platform === 'win32') {
      command = `start "" "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }

    exec(command, (err) => {
      if (err) {
        console.error('Failed to open Web Dashboard in browser:', err.message);
      }
    });
  }

  public stop(): void {
    if (this.systray) {
      try {
        this.systray.kill();
      } catch {}
      this.systray = null;
    }
    this.isRunning = false;
  }
}
