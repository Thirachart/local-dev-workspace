export interface TunnelConfig {
  issuer: string;
  requireCapabilityToken: boolean;
  sessionTtlMs: number;
}

export const defaultTunnelConfig: TunnelConfig = {
  issuer: 'chat-dev-mcp-v2',
  requireCapabilityToken: true,
  sessionTtlMs: 60 * 60 * 1000,
};
