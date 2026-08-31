# Secure MCP Tunnel v2 Specification

**Project:** Local Dev Tool MCP  
**Component:** Secure MCP Tunnel Layer  
**Version:** 2.0 (Dual Mode & Provider Abstraction)  
**Status:** Approved Implementation Specification  
**Reference Standard:** [OpenAI Platform > Organization Settings > Tunnels](https://platform.openai.com/settings/organization/tunnels)

---

## 1. Objective

Secure MCP Tunnel v2 เป็น remote transport หลักของ Local Dev Tool MCP ทำหน้าที่เชื่อมต่อ AI Clients ภายนอก (ChatGPT Web, OpenAI Codex, Remote AI Agents, และ Developer Teams) เข้ากับ Local Workspace อย่างปลอดภัยสูงสุด โดยมีระบบ Session Isolation, Dynamic Capability Mapping, Workspace Identity Binding และ Workspace Transaction Layer (CAS Hash Guard) เป็นส่วนหนึ่งของ Protocol

ไม่ใช่แค่ Reverse Proxy ธรรมดา แต่เป็น **Security Boundary & Zero-Trust Transaction Gateway** ของระบบ

---

## 2. Dual-Mode Architecture & Provider Abstraction

```text
               ┌────────────────────────────────────────┐
               │         AI Clients / Platforms         │
               └────────────────────────────────────────┘
                    │                              │
     (OpenAI Platform Connector)         (Standalone Remote Agent)
                    │                              │
                    ▼                              ▼
    ┌───────────────────────────────┐ ┌───────────────────────────────┐
    │       OpenAI Provider         │ │      Self-Hosted Provider     │
    │  (Official Platform Outbound) │ │   (Zero-Trust Inbound Gateway)│
    ├───────────────────────────────┤ ├───────────────────────────────┤
    │ • Outbound-only to OpenAI     │ │ • 4-Step Stateful Handshake   │
    │   Control Plane               │ │   (hello -> challenge ->      │
    │ • Tunnel ID: tun_xxxxx        │ │    authenticate -> accepted)  │
    │ • Runtime Key: sk-xxxx        │ │ • Short-lived Capability Token│
    │ • No open ports / No Ngrok    │ │ • WebSocket / HTTP Stream     │
    │ • Implements TunnelProvider   │ │ • Implements TunnelProvider   │
    └───────────────┬───────────────┘ └───────────────┬───────────────┘
                    │                                 │
                    └────────────────┬────────────────┘
                                     │
                                     ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │              Tunnel Provider Abstraction & Gateway              │
    ├─────────────────────────────────────────────────────────────────┤
    │ 1. Dynamic Capability Mapping (read/write/execute/git.commit)   │
    │ 2. Workspace Identity Jail (ws_xxxxx per project root)          │
    │ 3. Two-Level CAS Hash Guard & Snapshot Consistency              │
    │ 4. Replay Guard (5-min TTL Nonce Deduplication)                 │
    │ 5. In-Memory Ring Buffer Audit Logger (Metadata-Only, 1000 max) │
    └────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │             Workspace Transaction Core & Mutation Engine        │
    └─────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Design Principles

### 3.1 Pluggable Tunnel Providers
การเชื่อมต่อทั้งหมดถูกหุ้มด้วย **Tunnel Provider Abstraction (`TunnelProvider`)** เพื่อไม่ให้ระบบผูกติดกับ SDK หรือ 3rd-party vendor รายใดรายหนึ่ง:
- **`OpenAIProvider`**: Outbound-only connection ไปยัง OpenAI Platform Control Plane ตามมาตรฐาน Organization Settings Tunnels
- **`SelfHostedProvider`**: Zero-Trust Inbound Gateway พร้อม 4-Step Handshake และ Short-lived Capability Tokens

### 3.2 Dynamic Capability Mapping
- แมป Fine-grained Capabilities เข้ากับ Project Permission Matrix โดยอัตโนมัติ:
  - `workspace.read` / `file.read` ➔ `canRead`
  - `file.write` / `file.patch` ➔ `canWrite` + CAS Hash Verification
  - `terminal.execute` / `pty.spawn` ➔ `canRunCommand`
  - `git.commit` / `git.branch` ➔ Git Workflow Safety Gate

### 3.3 Workspace Isolation & Identity Jail
- ทุก Session ผูกติดกับ `workspaceId` (SHA-256 Fingerprint ของ Root Path) อย่างเข้มงวด
- ป้องกัน Path Traversal หรือการสลับโปรเจกต์ข้าม Session

### 3.4 In-Memory Privacy & Audit Integrity
- **Replay Guard**: จดจำ Request Nonces ในหน่วยความจำด้วย TTL 5 นาที เพื่อสกัดกั้น Replay Attacks
- **Metadata-Only Audit**: บันทึกประวัติการเรียก Tool ใน Memory Ring Buffer (จำกัด 1,000 รายการล่าสุด) เพื่อแสดงผลบน Local Dashboard โดย **ห้ามบันทึก Source Code, File Content, Secrets หรือ Tokens ลง Disk เด็ดขาด**

---

## 4. Component Structure & Provider Layer

```text
src/tunnel/
├── config/
│   └── tunnelConfig.ts           # Tunnel configuration loader & validator (Port 4100)
├── providers/
│   ├── tunnelProvider.ts         # Common TunnelProvider interface
│   ├── openaiProvider.ts         # OpenAI Platform outbound adapter
│   └── selfHostedProvider.ts     # Inbound zero-trust server adapter
├── inbound/
│   ├── tunnelServer.ts           # Inbound WebSocket/HTTP listener (Port 4100)
│   ├── handshake.ts              # 4-step stateful handshake engine
│   └── tunnelRouter.ts           # Route incoming tunnel frames to core tools
├── auth/
│   ├── tokenIssuer.ts            # Capability token issuer (TTL 3600s)
│   ├── tokenValidator.ts         # Constant-time token & capability validator
│   └── replayGuard.ts            # Nonce tracking with 5-minute memory TTL
├── session/
│   ├── tunnelSession.ts          # Tunnel session lifecycle & state machine
│   └── sessionStore.ts           # In-memory active session registry
└── audit/
    └── memoryRingAudit.ts        # Metadata-only in-memory ring buffer (1000 items)
```

---

## 5. Provider Interface Contract

```ts
export interface TunnelFrame {
  id: string;
  type: 'handshake' | 'mcp_request' | 'heartbeat' | 'disconnect';
  sessionId?: string;
  workspaceId?: string;
  capabilityToken?: string;
  nonce?: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface TunnelResponse {
  id: string;
  success: boolean;
  sessionId?: string;
  payload?: Record<string, unknown>;
  error?: {
    code: string;
    category: 'auth' | 'permission' | 'validation' | 'execution';
    message: string;
  };
}

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
  send(frame: TunnelFrame): Promise<TunnelResponse>;
  getStatus(): TunnelStatus;
}
```

---

## 6. Threat Model

| Threat Category | Risk Description | Mitigation Mechanism | Protected? |
|---|---|---|:---:|
| **Stolen Static Key** | คีย์ API ถูกขโมยแล้วนำไปใช้ซ้ำไม่จำกัดเวลา | เปลี่ยนมาใช้ Short-lived Capability Tokens (TTL 3600s) และ Session Revocation | ✅ **Yes** |
| **Replay Attack** | ดักจับ Request เก่าแล้วส่งซ้ำ (เช่น คำสั่ง git commit) | Nonce Verification + 5-Minute In-Memory Replay Guard Deduplication | ✅ **Yes** |
| **Workspace Escape** | โค้ดพยายามอ่าน/เขียนไฟล์นอก Project Root | `workspaceId` Jail Enforcement + Two-Level Path Assertion | ✅ **Yes** |
| **Unauthorized Mutation** | สั่งรันคำสั่งหรือเขียนไฟล์โดยไม่มีสิทธิ์ | Dynamic Capability Mapping สกัดกั้นก่อนส่งเข้า Engine | ✅ **Yes** |
| **Concurrent Edit Conflict** | แก้ไขไฟล์ทับซ้อนระหว่าง Session ต่างๆ | Two-Level CAS Hash Guard ตรวจ SHA-256 ก่อน Atomic Write | ✅ **Yes** |
| **Data Leakage in Logs** | Audit log บันทึก Code/Token ลง Disk | Memory-Only Ring Buffer (จำกัด 1000 items, Metadata เท่านั้น) | ✅ **Yes** |
| **Compromised Local OS User** | ผู้บุกรุกเข้าถึง User account บนเครื่อง Local ได้โดยตรง | อยู่นอกขอบเขต Network Security Protocol (OS-level responsibility) | ❌ **No** |
| **Malicious Root/Admin** | Malware หรือ Process อื่นที่มีสิทธิ์ Root บนเครื่อง | อยู่นอกขอบเขต Application Sandbox (Host OS responsibility) | ❌ **No** |

---

## 7. Protocol Handshake & Connection Lifecycles

### 7.1 OpenAI Outbound Provider Lifecycle
```text
[OpenAIProvider]                             [OpenAI Control Plane]
       │                                                │
       │──── HTTPS/WSS Outbound Connect (tun_xxx) ─────>│ (Authorized via Runtime Key)
       │<─── Connection Established & Ready ────────────│
       │                                                │
       │<─── MCP Request Frame (JSON-RPC) ──────────────│
       │     [Enforce Workspace & Capability Jail]      │
       │     [Execute in Transaction Layer]             │
       │──── MCP Response Frame ───────────────────────>│
```

### 7.2 Self-Hosted Inbound Provider Handshake
```text
[Remote Client]                              [SelfHostedProvider (Port 4100)]
       │                                                 │
       │─── 1. Client Hello (protocolVersion, nonce) ───>│
       │<── 2. Server Challenge (challengeId, salt) ─────│
       │─── 3. Authenticate (challengeId, signature) ───>│ (Verify Bootstrap Secret)
       │<── 4. Accepted (sessionId, capabilityToken) ────│ (TTL 3600s)
       │                                                 │
       │─── 5. Tool Call (sessionId, capabilityToken) ──>│
       │<── 6. Tool Result Envelope ─────────────────────│
```

---

## 8. Unified Configuration Matrix

รองรับการตั้งค่าผ่าน **4 ช่องทางพร้อมกัน** (`.env`, CLI Arguments, `config/auth.json`, และ Web Dashboard UI):

```yaml
tunnel:
  # Mode Selection: 'openai' | 'self-hosted' | 'dual'
  mode: dual

  # Mode 1: OpenAI Platform Outbound Provider
  openai:
    tunnelId: "tun_xxxxxxxxxxxxxxxx"
    runtimeKey: "sk-xxxxxxxxxxxxxxxx"
    endpoint: "https://api.openai.com/v1/tunnels"

  # Mode 2: Self-Hosted Inbound Provider
  inbound:
    port: 4100
    issuer: local-dev-tool-mcp
    sessionTtlSeconds: 3600
    requireCapabilityToken: true
    bootstrapSecret: "chatdev_xxxxxxxxxxxxxxxx"

  # Security & Audit
  security:
    replayTtlSeconds: 300
    auditRingBufferSize: 1000
```

---

## 9. Migration Path

ระบบวางแผนการเปลี่ยนผ่าน (Migration Plan) ออกเป็น 3 ระยะ เพื่อความต่อเนื่องและ Backward Compatibility:

```text
┌──────────────────────────┐     ┌──────────────────────────┐     ┌──────────────────────────┐
│   Phase v1 (Current)     │     │   Phase v2 (Inbound)     │     │   Phase v2.1 (OpenAI)    │
├──────────────────────────┤     ├──────────────────────────┤     ├──────────────────────────┤
│ • Bearer API Key         │ ──> │ • Capability Token       │ ──> │ • OpenAI Native Tunnel   │
│ • Ngrok                  │     │ • SelfHostedProvider     │     │ • OpenAIProvider         │
│ • Compatibility Port     │     │ • Zero-Trust Handshake   │     │ • Outbound-Only (No WAF) │
│ • SSE / OpenAPI Spec     │     │ • Standard Port 4100     │     │ • Dual Provider Switch   │
└──────────────────────────┘     └──────────────────────────┘     └──────────────────────────┘
```

- **Phase v1 (Legacy Compatibility)**: คงการทำงานของ Bearer API Key และ HTTP/SSE ไว้สำหรับเครื่องมือรุ่นเดิม
- **Phase v2 (Self-Hosted Zero-Trust)**: เปิดใช้งาน `SelfHostedProvider` บน Port 4100 พร้อมระบบ Handshake & Capability Token
- **Phase v2.1 (OpenAI Platform Native)**: เปิดใช้งาน `OpenAIProvider` เชื่อมต่อ Outbound ไปยัง OpenAI Tunnels Gateway โดยไม่ต้องเปิด Port

---

## 10. Implementation Phases & Task Breakdown

- **Phase 1 — Provider Abstraction & Replay Guard**:
  - `src/tunnel/providers/tunnelProvider.ts`
  - `src/tunnel/config/tunnelConfig.ts` (Port 4100 sync)
  - `src/tunnel/auth/replayGuard.ts`
  - `src/tunnel/audit/memoryRingAudit.ts`
- **Phase 2 — Inbound Handshake & Session Engine**:
  - `src/tunnel/inbound/handshake.ts`
  - `src/tunnel/auth/tokenIssuer.ts` & `tokenValidator.ts`
  - `src/tunnel/session/tunnelSession.ts` & `sessionStore.ts`
  - `src/tunnel/providers/selfHostedProvider.ts`
- **Phase 3 — OpenAI Platform Outbound Adapter**:
  - `src/tunnel/providers/openaiProvider.ts`
- **Phase 4 — Unified Router & Tool Registry Integration**:
  - `src/tunnel/inbound/tunnelRouter.ts`
  - เชื่อมโยงเข้ากับ `src/tools/registry.ts` และ `withV2Envelope`
- **Phase 5 — Conformance & Security Verification**:
  - `test/tunnel-handshake.test.ts`
  - `test/tunnel-replay-guard.test.ts`
  - `test/tunnel-providers.test.ts`

---

## 11. Definition of Done (DoD)

### Functional Requirements
- [ ] `TunnelProvider` interface ครอบคลุมทั้ง `OpenAIProvider` และ `SelfHostedProvider`
- [ ] Inbound Listener รันบน Port 4100 อย่างถูกต้อง
- [ ] Inbound 4-Step Handshake ทำงานสมบูรณ์ ออก `capabilityToken` ได้ถูกต้อง
- [ ] OpenAI Provider เชื่อมต่อ Outbound ผ่าน `tunnel_id` และ Runtime Key สำเร็จ
- [ ] Session Binding บังคับใช้ `workspaceId` ป้องกันข้ามโปรเจกต์ 100%
- [ ] Dynamic Capability Mapping สกัดกั้น Tool Call ที่ไม่มีสิทธิ์
- [ ] Tool Calls ผ่าน Tunnel ทั้งหมดทำงานผ่าน `Workspace Transaction Layer` พร้อมตรวจ CAS Hash Guard

### Security & Privacy Requirements
- [ ] ไม่มี Static API Key เป็น Single Point of Failure (ใช้ Short-lived Tokens)
- [ ] Replay Guard ปฏิเสธ Request ซ้ำที่มี Nonce เดิมภายใน 5 นาที
- [ ] Metadata-Only Audit บันทึกใน Memory Ring Buffer เท่านั้น ไม่บันทึก Code / Content / Secret ลง Disk
- [ ] Constant-time comparison สำหรับการตรวจสอบ Token / Secret ทุกจุด
- [ ] ป้องกันภัยคุกคามตาม Threat Model ครบถ้วน

### Test & Code Quality
- [ ] `npx tsc --noEmit` ผ่าน 0 Errors / 0 Warnings
- [ ] Conformance Test Suites ของ Tunnel ผ่าน 100%
- [ ] Isolated Integration Tests ผ่านครบถ้วน
