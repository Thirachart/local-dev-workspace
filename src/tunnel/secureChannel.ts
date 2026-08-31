import type { TunnelHandshake } from './tunnelHandshake.js';

export interface SecureChannel {
  handshake: TunnelHandshake;
  established: boolean;
}

export function establishSecureChannel(handshake: TunnelHandshake): SecureChannel {
  return {
    handshake,
    established: true,
  };
}
