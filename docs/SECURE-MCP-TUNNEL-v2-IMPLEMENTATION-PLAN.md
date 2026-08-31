# Secure MCP Tunnel v2 Implementation Plan

**Project:** Local Dev Tool MCP  
**Component:** Secure MCP Tunnel Layer  
**Version:** 2.0  
**Status:** Approved Implementation Plan

---

# 1. Scope

Secure MCP Tunnel v2 is the primary remote transport layer of Local Dev Tool MCP.

Goals:

- Zero-trust remote connection
- Session based authentication
- Workspace isolation
- Capability based authorization
- Secure MCP request routing
- Integration with Workspace Transaction Layer

Secure MCP Tunnel is not a reverse proxy. It is a security boundary between remote AI clients and local development environments.

---

# 2. Target Architecture

```text
AI Clients
(ChatGPT / Claude / Agents)
          |
          v
Secure MCP Tunnel v2
          |
Session + Capability Layer
          |
Workspace Identity
          |
MCP Request Router
          |
Local Dev Tool MCP Core
          |
Workspace Transaction Layer
```

---

# 3. Module Structure

```text
src/tunnel/

protocol/
  protocol.ts
  messageSchema.ts
  validation.ts
  errors.ts

server/
  tunnelServer.ts
  connectionManager.ts
  tunnelRouter.ts
  heartbeat.ts

session/
  tunnelSession.ts
  sessionStore.ts
  sessionLifecycle.ts

auth/
  handshake.ts
  tokenIssuer.ts
  tokenValidator.ts
  replayGuard.ts
  capabilityResolver.ts

transport/
  websocketTransport.ts
  streamTransport.ts

providers/
  tunnelProvider.ts
  openaiProvider.ts
  selfHostedProvider.ts

audit/
  tunnelAudit.ts
```

---

# Phase 1: Protocol Core

## Objective

Create stable tunnel message contracts.

## Implement

- handshake frame
- request frame
- response frame
- heartbeat frame
- disconnect frame
- protocol validation

## Files

```text
src/tunnel/protocol/
```

## Tests

```text
protocol-schema.test.ts
```

Acceptance:

- Invalid frames rejected
- Version mismatch rejected
- Unknown message types rejected

---

# Phase 2: Session Engine

## Objective

Manage secure client sessions.

## Implement

Session lifecycle:

```text
DISCONNECTED
CONNECTING
AUTHENTICATING
SESSION_CREATED
WORKSPACE_BOUND
ACTIVE
CLOSING
```

Features:

- create session
- expire session
- revoke session
- heartbeat
- reconnect

## Tests

```text
session-lifecycle.test.ts
```

---

# Phase 3: Authentication & Capability

## Objective

Replace permanent API key authentication with short-lived capability sessions.

Flow:

```text
Bootstrap Secret
        |
        v
Session Exchange
        |
        v
Capability Token
```

Implement:

- handshake
- token issuance
- token validation
- expiry
- replay protection
- capability resolution

## Tests

```text
capability-auth.test.ts
```

---

# Phase 4: Tunnel Server

## Objective

Create production tunnel runtime.

Implement:

```text
Client
 |
Tunnel Server
 |
Session
 |
MCP Router
 |
Tool Registry
```

Files:

```text
src/tunnel/server/
```

Features:

- connection management
- heartbeat
- graceful shutdown
- error handling

Tests:

```text
tunnel-server.test.ts
```

---

# Phase 5: Provider Abstraction

## Objective

Support multiple tunnel providers without changing MCP core.

Interface:

```ts
interface TunnelProvider {
  connect(): Promise<void>;
  send(frame: unknown): Promise<unknown>;
  disconnect(): Promise<void>;
}
```

Providers:

```text
OpenAI Provider
Self Hosted Provider
```

---

# Phase 6: MCP Core Integration

All transports must use the same execution path:

```text
stdio
SSE
OpenAPI
Secure Tunnel
        |
        v
Request Context
        |
Session Middleware
        |
Capability Guard
        |
Tool Registry
        |
Transaction Layer
```

Requirements:

- no transport bypass
- session context propagation
- workspace binding
- audit logging

---

# Phase 7: Production Hardening

Implement:

- reconnect handling
- heartbeat monitoring
- rate limiting
- token rotation
- graceful shutdown
- connection metrics
- tunnel audit events

---

# Phase 8: Test Matrix

## Connection

- connect
- reconnect
- timeout
- disconnect

## Security

- invalid token
- expired token
- replay request
- wrong workspace
- missing capability

## Integration

- read_file through tunnel
- apply_patch through tunnel
- terminal execution through tunnel
- git operation through tunnel

---

# Definition of Done

## Functional

- [ ] Tunnel server starts successfully
- [ ] Remote client handshake succeeds
- [ ] Session created successfully
- [ ] Workspace binding enforced
- [ ] Capability validation works
- [ ] MCP tools execute through tunnel
- [ ] Reconnect supported

## Security

- [ ] No permanent API key as primary authentication
- [ ] Token expiry implemented
- [ ] Token revoke implemented
- [ ] Replay protection implemented
- [ ] Audit stores metadata only

## Integration

- [ ] stdio uses shared core
- [ ] SSE uses shared core
- [ ] OpenAPI uses shared core
- [ ] Secure Tunnel uses shared core

---

# Release Sequence

1. Implement Phase 1-4
2. Integrate MCP Router
3. Add Providers
4. Complete Security Tests
5. Run Build and Integration Tests
6. Commit
7. Tag v2.0.0

