import type { AnyTunnelFrame, ResponseFrame, ErrorFrame } from '../protocol/protocol.js';

export interface TunnelStatus {
  provider: string;
  mode: 'outbound' | 'inbound';
  isConnected: boolean;
  activeSessions: number;
  tunnelId?: string;
  endpointUrl?: string;
  uptimeSeconds: number;
}

export interface TunnelProvider {
  readonly name: string;
  readonly mode: 'outbound' | 'inbound';

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(frame: AnyTunnelFrame): Promise<ResponseFrame | ErrorFrame>;
  getStatus(): TunnelStatus;
}
