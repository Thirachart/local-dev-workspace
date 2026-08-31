import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { WebSocketTransportAdapter } from '../src/tunnel/transport/websocketTransport.js';
import { TUNNEL_PROTOCOL_VERSION } from '../src/tunnel/protocol/protocol.js';
import { TunnelServerRuntime } from '../src/tunnel/server/tunnelServer.js';
import { TunnelBootstrapService } from '../src/tunnel/auth/bootstrapService.js';

describe('Phase 7: WebSocket Hardening & Network Resiliency', () => {
  describe('Live WebSocket Transport Suite', () => {
    let server: http.Server;
    let adapter: WebSocketTransportAdapter;
    let testPort: number;

    before(async () => {
      adapter = new WebSocketTransportAdapter();
      server = http.createServer();
      adapter.attachToServer(server);

      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          const addr = server.address() as net.AddressInfo;
          testPort = addr.port;
          resolve();
        });
      });
    });

    after(async () => {
      adapter.closeAll();
      adapter.removeAllListeners();
      if ((server as any).closeAllConnections) {
        (server as any).closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    function performWebSocketHandshake(socket: net.Socket): Promise<void> {
      const key = crypto.randomBytes(16).toString('base64');
      const req = [
        `GET /tunnel/ws HTTP/1.1`,
        `Host: 127.0.0.1:${testPort}`,
        `Upgrade: websocket`,
        `Connection: Upgrade`,
        `Sec-WebSocket-Key: ${key}`,
        `Sec-WebSocket-Version: 13`,
        `\r\n`,
      ].join('\r\n');

      socket.write(req);

      return new Promise((resolve, reject) => {
        socket.once('data', (data) => {
          const res = data.toString('utf-8');
          if (res.includes('101 Switching Protocols')) {
            resolve();
          } else {
            reject(new Error(`Handshake failed: ${res}`));
          }
        });
      });
    }

    function createMaskedFrame(payload: Buffer | string, opcode = 0x1, isFin = true): Buffer {
      const payloadBuf = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload;
      const length = payloadBuf.length;
      const maskKey = crypto.randomBytes(4);

      let header: Buffer;
      if (length <= 125) {
        header = Buffer.alloc(2 + 4);
        header[0] = (isFin ? 0x80 : 0x00) | (opcode & 0x0f);
        header[1] = 0x80 | length; // MASK = 1
        maskKey.copy(header, 2);
      } else if (length <= 65535) {
        header = Buffer.alloc(4 + 4);
        header[0] = (isFin ? 0x80 : 0x00) | (opcode & 0x0f);
        header[1] = 0x80 | 126;
        header.writeUInt16BE(length, 2);
        maskKey.copy(header, 4);
      } else {
        header = Buffer.alloc(10 + 4);
        header[0] = (isFin ? 0x80 : 0x00) | (opcode & 0x0f);
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(length), 2);
        maskKey.copy(header, 10);
      }

      const maskedPayload = Buffer.alloc(length);
      for (let i = 0; i < length; i++) {
        maskedPayload[i] = payloadBuf[i] ^ maskKey[i % 4];
      }

      return Buffer.concat([header, maskedPayload]);
    }

    it('1. Fragmented Frame: reassembles multi-chunk frames correctly', async () => {
      const socket = net.connect({ host: '127.0.0.1', port: testPort });
      await performWebSocketHandshake(socket);

      const fullFrameObj = {
        type: 'hello',
        protocolVersion: TUNNEL_PROTOCOL_VERSION,
        id: 'f_frag_1',
        timestamp: Date.now(),
        client: 'fragment-tester',
        nonce: 'nonce_fragment_12345',
      };
      const fullJson = JSON.stringify(fullFrameObj);
      const midPoint = Math.floor(fullJson.length / 2);

      const chunk1 = fullJson.slice(0, midPoint);
      const chunk2 = fullJson.slice(midPoint);

      const receivedPromise = new Promise<any>((resolve) => {
        adapter.once('message', ({ frame }) => resolve(frame));
      });

      // Send Fragment 1 (FIN = 0, Opcode = 1 Text)
      const frame1 = createMaskedFrame(chunk1, 0x1, false);
      socket.write(frame1);

      // Send Fragment 2 (FIN = 1, Opcode = 0 Continuation)
      const frame2 = createMaskedFrame(chunk2, 0x0, true);
      socket.write(frame2);

      const received = await receivedPromise;
      assert.strictEqual(received.type, 'hello');
      assert.strictEqual(received.client, 'fragment-tester');
      assert.strictEqual(received.nonce, 'nonce_fragment_12345');

      await new Promise<void>((r) => {
        socket.on('close', () => r());
        socket.destroy();
      });
    });

    it('2. Ping / Pong: automatically replies to ping with matching pong frame', async () => {
      const socket = net.connect({ host: '127.0.0.1', port: testPort });
      await performWebSocketHandshake(socket);

      const pingPayload = 'heartbeat_token_99';
      const pingFrame = createMaskedFrame(pingPayload, 0x9, true);

      const pongPromise = new Promise<Buffer>((resolve) => {
        socket.once('data', (data) => resolve(data));
      });

      socket.write(pingFrame);

      const pongData = await pongPromise;
      assert.strictEqual(pongData[0] & 0x0f, 0x0a); // Opcode 0xA is Pong
      assert.ok(pongData.toString('utf-8').includes('heartbeat_token_99'));

      await new Promise<void>((r) => {
        socket.on('close', () => r());
        socket.destroy();
      });
    });

    it('3. Large Payload: handles >100KB frame without truncation or corruption', async () => {
      const socket = net.connect({ host: '127.0.0.1', port: testPort });
      await performWebSocketHandshake(socket);

      const largeContent = 'X'.repeat(120 * 1024); // 120 KB payload
      const largeFrameObj = {
        type: 'request',
        protocolVersion: TUNNEL_PROTOCOL_VERSION,
        id: 'f_large_1',
        timestamp: Date.now(),
        sessionId: 'sess_large_test',
        capabilityToken: 'cap_large_test',
        tool: 'write_file',
        parameters: { path: 'large.ts', content: largeContent },
      };

      const receivedPromise = new Promise<any>((resolve) => {
        adapter.once('message', ({ frame }) => resolve(frame));
      });

      const largeFrame = createMaskedFrame(JSON.stringify(largeFrameObj), 0x1, true);
      socket.write(largeFrame);

      const received = await receivedPromise;
      assert.strictEqual(received.type, 'request');
      assert.strictEqual(received.parameters.content.length, 120 * 1024);

      await new Promise<void>((r) => {
        socket.on('close', () => r());
        socket.destroy();
      });
    });

    it('4. Reconnect after network drop: preserves session and capability validation', async () => {
      const bootstrap = new TunnelBootstrapService();
      const runtime = new TunnelServerRuntime({
        port: 0,
        bootstrapService: bootstrap,
        defaultWorkspaceId: 'ws_reconnect_test',
      });
      const srv = await runtime.start();
      const runtimePort = (srv.address() as net.AddressInfo).port;

      // 1. Initial Handshake over HTTP
      const nonce = `nonce_${crypto.randomBytes(8).toString('hex')}`;
      const helloRes = await fetch(`http://127.0.0.1:${runtimePort}/tunnel/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'hello',
          protocolVersion: TUNNEL_PROTOCOL_VERSION,
          id: 'f_h_rec',
          timestamp: Date.now(),
          client: 'reconnect-tester',
          nonce,
          requestedCapabilities: ['file.read', 'file.write'],
          workspaceHint: 'ws_reconnect_test',
        }),
      });
      const challenge = await helloRes.json();

      const signature = crypto
        .createHmac('sha256', bootstrap.getSecret())
        .update(`${challenge.challengeId}:${nonce}:${challenge.salt}`)
        .digest('hex');

      const authRes = await fetch(`http://127.0.0.1:${runtimePort}/tunnel/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'authenticate',
          protocolVersion: TUNNEL_PROTOCOL_VERSION,
          id: 'f_a_rec',
          timestamp: Date.now(),
          challengeId: challenge.challengeId,
          credential: signature,
          workspaceId: 'ws_reconnect_test',
        }),
      });
      const accepted = await authRes.json();
      const { sessionId, capabilityToken } = accepted;

      // 2. Simulate Connection 1 Register & Drop
      const conn1 = runtime.connectionManager.registerConnection('websocket', async () => {}, async () => {});
      runtime.connectionManager.bindSession(conn1.connectionId, sessionId, 'ws_reconnect_test');
      assert.strictEqual(runtime.connectionManager.getMetrics().activeConnections, 1);

      // Simulate abrupt network drop
      runtime.connectionManager.removeConnection(conn1.connectionId);
      assert.strictEqual(runtime.connectionManager.getMetrics().activeConnections, 0);

      // 3. Reconnect with new connection using existing active session
      const conn2 = runtime.connectionManager.registerConnection('websocket', async () => {}, async () => {});
      runtime.connectionManager.bindSession(conn2.connectionId, sessionId, 'ws_reconnect_test');

      assert.strictEqual(runtime.connectionManager.getMetrics().activeConnections, 1);
      assert.strictEqual(runtime.connectionManager.getMetrics().reconnectCount, 1);

      // 4. Send request after reconnect
      const reqRes = await fetch(`http://127.0.0.1:${runtimePort}/tunnel/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'request',
          protocolVersion: TUNNEL_PROTOCOL_VERSION,
          id: 'f_req_after_rec',
          timestamp: Date.now(),
          sessionId,
          capabilityToken,
          tool: 'read_file',
          parameters: { path: 'package.json' },
        }),
      });
      const reqData = await reqRes.json();
      assert.strictEqual(reqData.type, 'response');
      assert.strictEqual(reqData.success, true);

      await runtime.stop();
    });
  });
});
