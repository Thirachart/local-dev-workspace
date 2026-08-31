import type http from 'node:http';
import type stream from 'node:stream';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { AnyTunnelFrame } from '../protocol/protocol.js';
import { parseTunnelFrame, serializeTunnelFrame } from '../protocol/validation.js';

export interface WebSocketMessageEvent {
  connectionId: string;
  frame: AnyTunnelFrame;
}

export interface SocketState {
  connectionId: string;
  socket: stream.Duplex;
  fragmentBuffer: Buffer[];
  pendingBuffer: Buffer;
  expectedOpcode: number;
}

export class WebSocketTransportAdapter extends EventEmitter {
  private isAttached = false;
  private socketStates = new Map<stream.Duplex, SocketState>();

  public attachToServer(server: http.Server): void {
    if (this.isAttached) return;
    this.isAttached = true;

    server.on('upgrade', (req, socket, _head) => {
      const url = req.url || '';
      if (!url.startsWith('/tunnel/ws')) {
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }

      const acceptKey = this.generateAcceptKey(key);
      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n',
      ].join('\r\n');

      socket.write(responseHeaders);

      const connectionId = `ws_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const state: SocketState = {
        connectionId,
        socket,
        fragmentBuffer: [],
        pendingBuffer: Buffer.alloc(0),
        expectedOpcode: 0x1,
      };
      this.socketStates.set(socket, state);

      this.emit('connection', {
        connectionId,
        socket,
        send: (frame: AnyTunnelFrame | string) => {
          const payload = typeof frame === 'string' ? frame : serializeTunnelFrame(frame);
          const encoded = this.encodeWebSocketFrame(payload, 0x1);
          socket.write(encoded);
        },
        ping: (data = 'ping') => {
          const encoded = this.encodeWebSocketFrame(data, 0x9);
          socket.write(encoded);
        },
      });

      socket.on('data', (chunk) => {
        state.pendingBuffer = Buffer.concat([state.pendingBuffer, chunk]);
        this.processPendingBuffer(state);
      });

      socket.on('close', () => {
        this.socketStates.delete(socket);
        this.emit('close', connectionId);
      });

      socket.on('error', () => {
        this.socketStates.delete(socket);
        socket.destroy();
      });
    });
  }

  public generateAcceptKey(key: string): string {
    return crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
  }

  public processPendingBuffer(state: SocketState): void {
    let buffer = state.pendingBuffer;
    let offset = 0;

    while (offset < buffer.length) {
      if (buffer.length - offset < 2) break;

      const firstByte = buffer[offset];
      const secondByte = buffer[offset + 1];

      const isFin = (firstByte & 0x80) === 0x80;
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) === 0x80;
      let payloadLength = secondByte & 0x7f;

      let headerSize = 2;

      if (payloadLength === 126) {
        if (buffer.length - offset < 4) break;
        payloadLength = buffer.readUInt16BE(offset + 2);
        headerSize += 2;
      } else if (payloadLength === 127) {
        if (buffer.length - offset < 10) break;
        payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
        headerSize += 8;
      }

      if (isMasked) {
        headerSize += 4;
      }

      if (buffer.length - offset < headerSize + payloadLength) {
        // Incomplete packet in this TCP chunk, wait for remaining TCP bytes
        break;
      }

      const maskOffset = headerSize - 4;
      const payloadStart = offset + headerSize;
      const rawPayload = buffer.subarray(payloadStart, payloadStart + payloadLength);

      let unmaskedPayload: Buffer;
      if (isMasked) {
        const maskKey = buffer.subarray(offset + maskOffset, offset + maskOffset + 4);
        unmaskedPayload = Buffer.alloc(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
          unmaskedPayload[i] = rawPayload[i] ^ maskKey[i % 4];
        }
      } else {
        unmaskedPayload = rawPayload;
      }

      offset += headerSize + payloadLength;

      // Handle Opcodes
      if (opcode === 0x9) {
        // Ping -> Auto Pong
        const pongFrame = this.encodeWebSocketFrame(unmaskedPayload.toString('utf-8'), 0xa);
        state.socket.write(pongFrame);
        this.emit('ping', { connectionId: state.connectionId, data: unmaskedPayload });
        continue;
      }

      if (opcode === 0xa) {
        // Pong received
        this.emit('pong', { connectionId: state.connectionId, data: unmaskedPayload });
        continue;
      }

      if (opcode === 0x8) {
        // Close frame
        state.socket.end();
        continue;
      }

      // Continuation or initial text frame
      if (opcode !== 0x0) {
        state.expectedOpcode = opcode;
      }

      state.fragmentBuffer.push(unmaskedPayload);

      if (isFin) {
        const fullBuffer = Buffer.concat(state.fragmentBuffer);
        state.fragmentBuffer = [];

        try {
          const text = fullBuffer.toString('utf-8');
          const frame = parseTunnelFrame(text);
          this.emit('message', { connectionId: state.connectionId, frame });
        } catch (err) {
          this.emit('parse_error', { connectionId: state.connectionId, error: err });
        }
      }
    }

    state.pendingBuffer = buffer.subarray(offset);
  }

  public encodeWebSocketFrame(payload: string | Buffer, opcode = 0x1): Buffer {
    const payloadBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload;
    const length = payloadBuf.length;

    let header: Buffer;

    if (length <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | (opcode & 0x0f); // FIN = 1
      header[1] = length; // Unmasked (server to client)
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | (opcode & 0x0f);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    return Buffer.concat([header, payloadBuf]);
  }

  public closeAll(): void {
    for (const [socket] of this.socketStates.entries()) {
      socket.destroy();
    }
    this.socketStates.clear();
  }
}
