# Context Delivery Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ( - [ ] ) syntax for tracking.

**Goal:** Add honest, session-scoped delivery tracking for read_file and a read-only context_delivery_status tool so the app can report whether the current file/range was already returned without claiming that an AI model consumed it.

**Architecture:** Keep ContextLedger and DeliveryPlanner as the deep delivery module. Add a small DeliveryScopeResolver that converts MCP request context into a stable session/process scope. Make read_file prepare and commit delivery records only after constructing a successful response, and let context_delivery_status query the same ledger without creating a delivery. Keep source content in a bounded, expiring memory cache only for diff generation; keep delivery metadata separate from cached content.

**Tech Stack:** TypeScript ESM, Node.js node:test, tsx, @modelcontextprotocol/sdk request context, Node crypto.randomUUID/SHA-256, existing FileService, ProjectService, public tool registry, and existing permission/snapshot wrapper.

**Spec:** docs/superpowers/specs/2026-08-22-context-delivery-tracking-design.md

## Global Constraints

- serverEmitted means the tool handler constructed and returned a successful result. It never means the model read, understood, or retained the content.
- hashConfirmed means a later request presented the same known_sha256 in the same scope. It is indirect evidence only, not an explicit model acknowledgement.
- Scope is isolated by session plus project. Never use a process-wide fallback for a stateless HTTP request with no sessionId.
- Stdio may use one process-local scope because the process has one connected client; stateful MCP transports use RequestHandlerExtra.sessionId.
- Do not change src/tunnel/protocol, tunnel frame schemas, or add an acknowledgement frame in this slice.
- Preserve existing read_file fields and known_sha256 behavior. Additive fields are allowed; existing clients must continue to parse full, diff, unchanged, and sha256.
- context_delivery_status must pass existing project permission/path-jail checks, never return source content, and never create a content-delivery record.
- Source content may be retained only in the bounded in-memory cache: 256 resource versions, 16 MiB total content, and 30-minute TTL by default. No ledger content or delivery metadata may be persisted to disk or written to handoff/activity logs.
- A missing diff base must fall back to full with deliveryFallback equal to base_not_cached; it must not fail read_file.
- Use test-first steps: write the focused failing test, run it to observe RED, implement the smallest behavior, then run it GREEN before moving on.
- Do not include absolute paths, project names, session IDs, or source content in opaque deliveryId values.
- Do not make context_delivery_status a required preflight for read_file. The normal agent path must remain one read call.
- Treat automatic known_sha256 injection as follow-up work, not part of this implementation slice. Any future runtime automation must prove model-visible context residency (or guaranteed rehydration) before suppressing a full delivery; server delivery history alone is insufficient.

## Follow-up Requirement: Reduce AI Bookkeeping

After this server-side tracking slice is stable, add a client/runtime delivery adapter that can reuse `known_sha256` without making the model manage hashes manually.

The follow-up implementation must satisfy all of these constraints:

- remember hashes by session + project + normalized resource key/range;
- attach a remembered hash only when the corresponding base content is still model-visible or can be rehydrated safely;
- invalidate remembered context residency after compaction, truncation, model/session handoff, or any host event that can drop prior tool content;
- prefer a fresh full read whenever context residency is uncertain;
- never require context_delivery_status before read_file;
- never override an explicitly supplied known_sha256;
- update remembered state only after a successful read result;
- keep this bookkeeping metadata-only unless a separate bounded rehydration-cache design is approved;
- preserve the meaning of serverEmitted/hashConfirmed and never interpret automatic reuse as proof of model consumption.

This follow-up exists specifically to keep token savings from becoming extra reasoning work for the AI.

### Task 1: Add stable request-scope resolution

**Files:**

- Create: src/context/deliveryScope.ts
- Modify: src/index.ts around tool registration and transport selection
- Test: test/delivery-scope.test.ts

**Interfaces:**

- Consumes: the existing config.isSse transport selection and the MCP callback's structural sessionId context.
- Produces: DeliveryScopeResolver, DeliveryScope, and the knowledgeScope values used by the ledger/status response.

- [ ] Step 1: Write failing scope-resolution tests

Create tests for these exact cases:

    const http = new DeliveryScopeResolver('http', 'instance_1');
    const stdio = new DeliveryScopeResolver('stdio', 'instance_1');

    assert.deepEqual(http.resolve({ sessionId: 's1' }, 'project-a'), {
      scopeId: 'session:s1' + '\u0000' + 'project:project-a',
      knowledgeScope: 'session',
      trackable: true,
    });

    assert.equal(http.resolve({}, 'project-a').knowledgeScope, 'unknown');
    assert.equal(http.resolve({}, 'project-a').trackable, false);
    assert.equal(stdio.resolve({}, 'project-a').knowledgeScope, 'process_local');
    assert.equal(stdio.resolve({}, 'project-a').scopeId,
      'process:instance_1' + '\u0000' + 'project:project-a');

Also test that the same session/project produces the same scope ID, a different project produces a different scope ID, and arbitrary session strings are treated as opaque values rather than interpolated into a delivery ID.

- [ ] Step 2: Run the focused test and verify RED

Run: node --import tsx --test test/delivery-scope.test.ts

Expected: FAIL because src/context/deliveryScope.ts does not exist.

- [ ] Step 3: Implement the resolver

Create this boundary without importing MCP SDK generics into the context module:

    export type DeliveryTransport = 'stdio' | 'http';
    export type KnowledgeScope = 'session' | 'process_local' | 'unknown';

    export interface DeliveryScope {
      scopeId?: string;
      knowledgeScope: KnowledgeScope;
      trackable: boolean;
    }

    export interface DeliveryRequestContext {
      sessionId?: string;
    }

    export class DeliveryScopeResolver {
      constructor(
        private readonly transport: DeliveryTransport,
        private readonly processInstanceId: string,
      ) {}

      resolve(extra: DeliveryRequestContext | undefined, projectId: string): DeliveryScope;
    }

Use extra.sessionId for HTTP when present. Use the injected process instance only for stdio. Return knowledgeScope unknown and trackable false for HTTP without a session. Construct scope IDs with an internal delimiter and the project ID; these IDs stay inside the ledger and are never returned to the client.

- [ ] Step 4: Wire the resolver at application startup

In src/index.ts, create one process instance ID at startup and pass a DeliveryScopeResolver configured as http for config.isSse and stdio otherwise into registerTools. Keep the current transport startup order and do not alter SSE/tunnel frame handling. Make the service property optional inside registerTools so existing unit fixtures that do not provide it default to an untrackable scope instead of failing registration.

- [ ] Step 5: Run the focused test and commit the scope slice

Run: node --import tsx --test test/delivery-scope.test.ts

Expected: all scope and isolation tests pass.

Commit: git add src/context/deliveryScope.ts src/index.ts test/delivery-scope.test.ts && git commit -m "feat: add session-scoped delivery resolver"

### Task 2: Make the ledger bounded, session-aware, and two-phase

**Files:**

- Modify: src/context/contextLedger.ts
- Modify: src/context/deliveryPlanner.ts
- Test: test/context-delivery-ledger.test.ts
- Modify: test/phase2-conformance.test.ts

**Interfaces:**

- Consumes: the existing ContextLedger/DeliveryPlanner full-diff-unchanged behavior.
- Produces: delivery records, delivery IDs, status snapshots, bounded content caching, expiry, and explicit commit/confirmation operations.

- [ ] Step 1: Write failing ledger tests for records and truthful states

Add tests with an injected clock and ID factory so results are deterministic. Cover:

1. prepare for a first version returns full and a delivery ID but does not make status report serverEmitted before commit;
2. committing the first version makes status delivered_unconfirmed;
3. presenting the same hash confirms that version and makes status delivered_hash_confirmed;
4. changed content with a cached base returns diff and a different delivery ID;
5. a changed version reports content_changed before a new read and recommends diff only while the old base remains cached;
6. no resource record in an active scope reports never_delivered;
7. a different session or project cannot see the first scope's record;
8. an expired record/tombstone reports unknown, not never_delivered.

Use assertions that the delivery record contains hashes, timestamps, and mode but no content property.

- [ ] Step 2: Run the focused test and verify RED

Run: node --import tsx --test test/context-delivery-ledger.test.ts

Expected: FAIL because the current ledger stores project-scoped content entries and has no delivery ID, status state, expiry, or commit boundary.

- [ ] Step 3: Implement the bounded ContextLedger storage boundary

Replace the unbounded content-bearing entry shape with separate metadata and content-cache maps. Keep the public module in src/context/contextLedger.ts and inject options for deterministic testing:

    export interface ContextLedgerOptions {
      maxEntries?: number;
      maxContentBytes?: number;
      ttlMs?: number;
      now?: () => number;
      idFactory?: () => string;
    }

    export interface DeliveryRecord {
      deliveryId: string;
      scope: string;
      projectId: string;
      key: string;
      sha256: string;
      mode: 'full' | 'diff' | 'reference';
      baseSha256?: string;
      serverEmittedAt: number;
      hashConfirmedAt?: number;
      expiresAt: number;
    }

    export class ContextLedger {
      constructor(options?: ContextLedgerOptions);
      get(scope: string, key: string, sha256: string): DeliveryRecord | undefined;
      getContent(scope: string, key: string, sha256: string): string | undefined;
      commit(record: DeliveryRecord, content: string): void;
      confirmHash(scope: string, key: string, sha256: string): boolean;
      getStatus(scope: string, key: string, currentSha256: string): DeliveryStatusResult;
      clearScope(scope: string): void;
    }

Use randomUUID (or the injected factory) to create del_ IDs. Evict expired entries before lookup/write, enforce both entry count and byte count, and retain only a short-lived scope marker/tombstone needed to distinguish active never_delivered from expired unknown. getContent is an internal planner dependency; do not expose it through the MCP status result.

- [ ] Step 4: Refactor DeliveryPlanner to prepare, commit, and confirm

Keep scope as an opaque string in the planner so existing internal callers remain easy to migrate. Add projectId and knowledgeScope as optional production inputs, defaulting legacy direct planner tests to a process-local scope. Extend DeliveryPlan with deliveryId and deliveryFallback values base_not_cached or scope_unavailable.

Implement these methods:

    plan(options: {
      scope?: string;
      projectId?: string;
      key: string;
      content: string;
      knownSha256?: string;
      operationId?: string;
    }): DeliveryPlan;

    commit(options: {
      scope: string;
      projectId: string;
      key: string;
      content: string;
      plan: DeliveryPlan;
    }): void;

plan must not commit a server-emitted record. If knownSha256 equals the current hash and a matching record exists, return unchanged with that record's delivery ID; commit then confirms the hash. If the base content exists, return diff with a new delivery ID. If it does not, return full, set deliveryFallback to base_not_cached, and create a new delivery ID at commit. For an untrackable scope, allow the current hash comparison without writing shared ledger history, return scope_unavailable when a fresh delivery cannot be tracked, and never make that request visible to another scope.

- [ ] Step 5: Update phase-2 planner conformance tests

Change test/phase2-conformance.test.ts so each direct planner call commits successful plans before the next assertion. Preserve the existing assertions for full, unchanged, and diff, then add checks for delivery ID reuse on unchanged, new ID on diff, and no source content in records. Keep the public registry coverage test unchanged except for the new tool added in Task 3.

- [ ] Step 6: Run the ledger and phase-2 tests and commit

Run:

    node --import tsx --test test/context-delivery-ledger.test.ts
    node --import tsx --test test/phase2-conformance.test.ts --test-name-pattern "Context Ledger"

Expected: all delivery-state, eviction, isolation, and legacy planner tests pass.

Commit: git add src/context/contextLedger.ts src/context/deliveryPlanner.ts test/context-delivery-ledger.test.ts test/phase2-conformance.test.ts && git commit -m "feat: add bounded context delivery ledger"

### Task 3: Wire read_file and add context_delivery_status

**Files:**

- Modify: src/tools/index.ts around registerTools, the registration wrapper, and read_file
- Modify: src/tools/registry.ts around the read_file metadata
- Modify: src/tunnel/auth/capabilityResolver.ts around the read-operation map
- Modify: src/utils/logger.ts around the read-category expression
- Test: test/context-delivery-tools.test.ts
- Modify: test/project-scoping-regression.test.ts
- Modify: test/capability-auth.test.ts

**Interfaces:**

- Consumes: DeliveryScopeResolver, ContextLedger, and the two-phase DeliveryPlanner from Tasks 1-2.
- Produces: read_file.deliveryId, truthful delivery status, a public status tool, file.read tunnel capability classification, and read-category activity logging.

- [ ] Step 1: Create the real-tool fixture and write failing behavior tests

Create test/context-delivery-tools.test.ts using a temporary registered project and the existing FileService/ProjectService stack. Capture registered callbacks as args plus optional extra so tests can provide MCP-like session context. Register tools with an HTTP DeliveryScopeResolver using a deterministic process ID.

Add tests for this sequence:

    const first = await readFile({ project, path: 'sample.txt' }, { sessionId: 'session-a' });
    const firstPayload = parseToolText(first);
    assert.equal(firstPayload.delivery, 'full');
    assert.match(firstPayload.deliveryId, /^del_/);

    const beforeAck = await status({ project, path: 'sample.txt' }, { sessionId: 'session-a' });
    assert.equal(parseToolText(beforeAck).status, 'delivered_unconfirmed');

    const second = await readFile(
      { project, path: 'sample.txt', known_sha256: firstPayload.sha256 },
      { sessionId: 'session-a' },
    );
    const secondPayload = parseToolText(second);
    assert.equal(secondPayload.delivery, 'unchanged');
    assert.equal(secondPayload.deliveryId, firstPayload.deliveryId);
    assert.equal('content' in secondPayload, false);

    const afterAck = await status({ project, path: 'sample.txt' }, { sessionId: 'session-a' });
    assert.equal(parseToolText(afterAck).status, 'delivered_hash_confirmed');

    const otherSession = await status({ project, path: 'sample.txt' }, { sessionId: 'session-b' });
    assert.equal(parseToolText(otherSession).status, 'never_delivered');

Also test changed content (content_changed, then diff/new ID), status output containing no source content, a failed read_file not creating a delivery record, and an HTTP callback with no session returning unknown rather than reading session A's history.

- [ ] Step 2: Run the focused tool test and verify RED

Run: node --import tsx --test test/context-delivery-tools.test.ts

Expected: FAIL because read_file has no delivery ID/context handling and context_delivery_status is not registered.

- [ ] Step 3: Pass request context through the registration wrapper

Keep all existing handlers working. Preserve the current handler(args, ...rest) call, but type the delivery-aware callbacks to consume the MCP extra argument structurally:

    type ToolExtra = { sessionId?: string } | undefined;

Add an optional deliveryScopeResolver service with an unknown/untrackable default for existing fixtures. Do not derive scope from args.project alone; combine it with the resolver's session/process identity.

- [ ] Step 4: Update read_file with prepare/commit delivery semantics

In the existing read_file handler:

1. Keep projectService.getRequiredProject, fileService.readFile, and current line normalization unchanged.
2. Build the exact existing resource key from result.resolvedPath, result.startLine, and result.endLine.
3. Resolve the scope using the callback extra and project ID.
4. Call deliveryPlanner.plan with the scope, project ID, resource key, content, and known_sha256.
5. Build the current JSON payload, preserving the existing content omission for unchanged, and add deliveryId plus deliveryFallback when present.
6. Call deliveryPlanner.commit only after the successful payload is constructed and immediately before returning it.
7. Leave the existing error response path unchanged; an exception must not commit a delivery.

For an untrackable HTTP scope, do not read or reuse another scope's cache. The current hash may still produce a request-local unchanged response when it matches known_sha256; otherwise return a fresh response with tracking unavailable rather than claiming persistent status.

- [ ] Step 5: Add context_delivery_status

Register this tool immediately beside read_file with the same project/path/line/cwd fields and descriptions. Use the same FileService.readFile options and resource-key normalization as read_file, compute the current SHA-256 with sha256Content, then call the ledger status query. Do not call DeliveryPlanner.plan, do not cache current content, and do not return result.content. Format the response with status, currentSha256, optional lastDeliveredSha256, optional lastDelivery (deliveryId, mode, ISO serverEmittedAt), evidence, resendRequired, recommendedDelivery, and knowledgeScope.

- [ ] Step 6: Register security metadata and read classification

Add this exact public metadata entry, matching read_file:

    { name: 'context_delivery_status', capability: 'read', mutation: false, snapshotPolicy: 'observe', audit: false, compatibility: 'legacy-compatible' }

Add context_delivery_status with required capability file.read to TOOL_CAPABILITY_MAP so custom tunnel authorization does not fall through to the broader workspace.read default. Add the tool name to the read-category logger expression. Do not add a tunnel frame or a REST endpoint in this slice.

- [ ] Step 7: Extend project/capability regression fixtures

Update the fake server callback type in test/project-scoping-regression.test.ts to accept the optional extra context and provide the optional resolver when registering tools. The existing schema tests must now include context_delivery_status and still require the exact project description. Add a capability test that CapabilityResolver.resolveRequiredCapability('context_delivery_status') returns file.read.

- [ ] Step 8: Run the focused tool and regression tests and commit

Run:

    node --import tsx --test test/context-delivery-tools.test.ts
    node --import tsx --test test/project-scoping-regression.test.ts
    node --import tsx --test test/capability-auth.test.ts

Expected: first/full, unchanged/no resend, changed/diff, session isolation, unknown scope, no-content status, failed-read, registry schema, and capability tests pass.

Commit: git add src/tools/index.ts src/tools/registry.ts src/tunnel/auth/capabilityResolver.ts src/utils/logger.ts test/context-delivery-tools.test.ts test/project-scoping-regression.test.ts test/capability-auth.test.ts && git commit -m "feat: expose context delivery status"

### Task 4: Close compatibility and privacy regressions

**Files:**

- Modify: test/phase2-conformance.test.ts
- Modify: test/context-delivery-ledger.test.ts
- Modify: test/context-delivery-tools.test.ts
- Modify: test/project-scoping-regression.test.ts

- [ ] Step 1: Add explicit privacy assertions

Assert that:

- context_delivery_status output never contains the source string, even when the source was cached for a diff;
- DeliveryRecord/status objects contain hashes and metadata only;
- deliveryId does not contain the project name, absolute path, or source text;
- logger/action output for the new tool does not serialize source content;
- the custom tunnel protocol test fixtures remain compatible with their existing frame shapes.

- [ ] Step 2: Add eviction and failure-path regressions

Use a one-entry or small-byte ledger to force the diff base out of cache. Verify the next changed read_file returns full with deliveryFallback equal to base_not_cached, not an error. Trigger a nonexistent-file read, then query a valid resource in the same scope and verify it is still never_delivered.

- [ ] Step 3: Re-run all focused suites after the assertions

Run:

    node --import tsx --test test/delivery-scope.test.ts test/context-delivery-ledger.test.ts test/context-delivery-tools.test.ts
    node --import tsx --test test/phase2-conformance.test.ts test/project-scoping-regression.test.ts test/capability-auth.test.ts

Expected: zero failures and no change to unrelated tool behavior.

### Task 5: Full verification and handoff

**Files:**

- Verify: all files changed by Tasks 1-4
- Spec reference: docs/superpowers/specs/2026-08-22-context-delivery-tracking-design.md

- [ ] Step 1: Run the complete test suite

Run: npm test

Expected: test/all-conformance.test.ts exits with code 0 and includes the new registry/tool tests.

- [ ] Step 2: Run the phase-2 suite explicitly

Run: npm run test:phase2

Expected: the existing planner, registry, platform, and mutation-safety conformance tests remain green.

- [ ] Step 3: Type-check and build

Run:

    npx tsc --noEmit
    npm run build

Expected: no TypeScript errors and a successful dist/index.js ESM bundle.

- [ ] Step 4: Inspect the final diff for scope and secrets

Run:

    git diff --check
    git status --short
    git diff --stat

Confirm that only the intended context, tool, registry, capability, logger, startup, and test files changed; no source content, runtime data, generated files, or persistent ledger file was added.

- [ ] Step 5: Record the implementation handoff

Summarize the verified behavior using the exact terms full, diff, unchanged, delivered_unconfirmed, delivered_hash_confirmed, content_changed, and unknown. Explicitly state that the feature proves server-side delivery/history only and does not prove model consumption. If implementation is executed in a separate work session, use superpowers:subagent-driven-development or superpowers:executing-plans and check off each task only after its tests pass.
