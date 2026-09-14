export interface ServerConfig {
  cwd: string;
  isSse: boolean;
  port: number;
  host: string;
  ngrokToken?: string;
}

export interface TaskInfo {
  id: string;
  command: string;
  cwd: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'running' | 'completed' | 'failed' | 'killed';
  exitCode?: number | null;
  outputBuffer: string[];
  pid?: number;
  timedOut?: boolean;
}
