import type { PlatformAdapter } from './platformAdapter.js';
import { MacOsPlatformAdapter } from './macos/macosAdapter.js';
import { WindowsPlatformAdapter } from './windows/windowsAdapter.js';

export function createPlatformAdapter(platform: NodeJS.Platform = process.platform): PlatformAdapter {
  if (platform === 'win32') return new WindowsPlatformAdapter();
  if (platform === 'darwin') return new MacOsPlatformAdapter();

  const err: any = new Error(`[UNSUPPORTED_PLATFORM] Platform "${platform}" is not supported by the v2 PlatformAdapter.`);
  err.category = 'execution';
  err.code = 'UNSUPPORTED_PLATFORM';
  throw err;
}
