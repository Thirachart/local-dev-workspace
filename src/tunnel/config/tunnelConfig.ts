export interface TunnelConfig {
  mode: 'openai' | 'self-hosted' | 'dual';
  inbound: {
    port: number;
    issuer: string;
    sessionTtlSeconds: number;
    requireCapabilityToken: boolean;
    bootstrapSecret?: string;
  };
  openai: {
    tunnelId?: string;
    runtimeKey?: string;
    endpoint: string;
  };
  security: {
    replayTtlSeconds: number;
    auditRingBufferSize: number;
  };
}

export const defaultTunnelConfig: TunnelConfig = {
  mode: 'dual',
  inbound: {
    port: 4100, // Standard app port
    issuer: 'local-dev-tool-mcp',
    sessionTtlSeconds: 3600,
    requireCapabilityToken: true,
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/tunnels',
  },
  security: {
    replayTtlSeconds: 300,
    auditRingBufferSize: 1000,
  },
};

export function loadTunnelConfig(overrides?: Partial<TunnelConfig>): TunnelConfig {
  const envPort = process.env.PORT || process.env.TUNNEL_PORT;
  const port = envPort ? parseInt(envPort, 10) : defaultTunnelConfig.inbound.port;

  return {
    mode: (process.env.TUNNEL_MODE as any) || overrides?.mode || defaultTunnelConfig.mode,
    inbound: {
      ...defaultTunnelConfig.inbound,
      port,
      bootstrapSecret: process.env.TUNNEL_BOOTSTRAP_SECRET || overrides?.inbound?.bootstrapSecret,
      ...overrides?.inbound,
    },
    openai: {
      ...defaultTunnelConfig.openai,
      tunnelId: process.env.OPENAI_TUNNEL_ID || overrides?.openai?.tunnelId,
      runtimeKey: process.env.OPENAI_RUNTIME_KEY || overrides?.openai?.runtimeKey,
      ...overrides?.openai,
    },
    security: {
      ...defaultTunnelConfig.security,
      ...overrides?.security,
    },
  };
}
