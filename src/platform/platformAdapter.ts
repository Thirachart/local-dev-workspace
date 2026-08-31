export interface AtomicReplaceRequest {
  sourcePath: string;
  targetPath: string;
}

export interface AtomicReplaceResult {
  success: boolean;
  provider: string;
  attempts: number;
  warnings: string[];
}

export interface PtyProcessHandle {
  readonly provider: string;
}

export interface PtyOptions {
  executable: string;
  args?: string[];
  cwd: string;
}

export interface ObservationOptions {
  exclude?: string[];
  includeIgnored?: boolean;
}

export interface FileObservationEntry {
  relativePath: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface FileObservation {
  root: string;
  entries: FileObservationEntry[];
  fingerprint: string;
}

export interface PlatformCapabilities {
  platform: NodeJS.Platform;
  atomicReplace: {
    supported: boolean;
    provider: string;
    reason?: string;
  };
  pty: {
    supported: boolean;
    provider: string;
  };
}

export interface PlatformAdapter {
  readonly platform: NodeJS.Platform;
  getCapabilities(): Promise<PlatformCapabilities>;
  atomicReplace(request: AtomicReplaceRequest): Promise<AtomicReplaceResult>;
  observeFilesystem(root: string, options?: ObservationOptions): Promise<FileObservation>;
  normalizePath(input: string): string;
}
