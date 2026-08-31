# Context Delivery Tracking Design

**Date:** 2026-08-22  
**Status:** Draft for review

## Problem

The current `read_file` flow already avoids resending unchanged content when the caller supplies `known_sha256`:

- first read returns `delivery: "full"` and the current hash;
- a read with the same hash returns `delivery: "unchanged"`;
- a read with an older cached hash can return a bounded `delivery: "diff"`.

That mechanism answers whether the current request needs the content again. It does not answer, in a queryable and session-safe way, whether this particular project/resource was previously delivered to this client context. It also cannot distinguish a server response that was produced from proof that a model actually consumed or retained the content.

The system must be explicit about that boundary: the server can record that a tool result was successfully produced and can observe a later matching `known_sha256`; it cannot prove that an AI model read, remembered, or used the content unless a future protocol supplies an explicit acknowledgement.

## Decision summary

Extend the existing in-memory `ContextLedger` into a session-scoped delivery ledger and add a read-only `context_delivery_status` tool.

The first iteration will:

1. keep `known_sha256` as the compatibility mechanism for duplicate suppression;
2. add a `deliveryId` to successful `read_file` results;
3. record delivery metadata by `sessionId + projectId + resourceKey`;
4. expose current-file status without returning source content;
5. use the MCP request context (`RequestHandlerExtra.sessionId`) when available;
6. keep source content only in a bounded, expiring in-memory cache for diff generation;
7. make no changes to the custom tunnel frame protocol;
8. defer a real acknowledgement message such as `ack_context_delivery` to a later protocol version.

## Goals

- Let an agent ask whether the exact current file/range was already delivered in its current session.
- Make duplicate suppression observable: `full`, `diff`, or `unchanged` remains the source of truth for whether file content was resent by `read_file`.
- Preserve the current `known_sha256` request and response behavior for existing clients.
- Keep the normal read path to one tool call. `context_delivery_status` is diagnostic/on-demand and must not become a prerequisite before `read_file`.
- Minimize AI bookkeeping. The agent should not need to reason about delivery state beyond optionally reusing a hash it already has.
- Prevent one session or project from seeing another session's delivery history.
- Return only hashes, delivery metadata, and recommendations from the status tool; never return cached source content there.
- Make memory use bounded and ensure source content is never persisted to disk by this feature.

## Non-goals

- Proving that the model consumed, understood, or retained a tool result.
- Adding an explicit acknowledgement frame to the tunnel protocol in this iteration.
- Persisting delivery history across server restarts.
- Tracking every read-like tool in the first slice; `read_file` is the initial producer.
- Replacing the existing file permission, path-jail, project, snapshot, or audit behavior.
- Sending a whole file solely to answer a status query.

## AI ergonomics and automatic hash bookkeeping requirements

The long-term interface should make delivery optimization mostly invisible to the model. `known_sha256` remains the compatibility mechanism in this iteration, but a future client/runtime adapter may manage it automatically.

Requirements for that future automation:

1. **No mandatory status preflight.** A normal file read must remain a single `read_file` call. The runtime must not require the model to call `context_delivery_status` before reading a file.
2. **Automatic hash reuse is optional and transparent.** A compatible runtime may remember the last successful `sha256` for `session + project + resourceKey` and attach it as `known_sha256` on a later `read_file` call without requiring the model to reason about the hash explicitly.
3. **Context residency is required before suppression.** The runtime must not auto-supply a remembered hash solely because the server previously emitted that version. It may do so only when it can establish that the corresponding content is still available to the model-visible context, or that the runtime can rehydrate that content if the server replies `unchanged`/`diff`.
4. **Context compaction must invalidate unsafe assumptions.** If conversation compaction, truncation, model handoff, session replacement, or another host action may have removed the prior file content from model-visible context, automatic hash reuse must be disabled for that resource until a fresh `full` delivery (or equivalent rehydration) occurs.
5. **Explicit caller intent wins.** If the caller explicitly supplies `known_sha256`, the runtime must not replace it with another remembered hash.
6. **Successful reads only update bookkeeping.** Failed reads, failed handlers, cancelled requests, and status-only queries must not advance the runtime's remembered content version.
7. **Scope isolation is identical to delivery tracking.** Automatic bookkeeping must be isolated by session, project, normalized resource key, and requested line range. It must never leak across projects or unrelated sessions.
8. **Metadata only.** The automatic bookkeeping layer should retain hashes and delivery metadata only unless a separate, explicitly bounded context-rehydration cache is designed. It must not silently introduce a second unbounded source-content cache.
9. **Safe fallback beats token savings.** If the runtime is uncertain whether the model still has the base content, it must omit `known_sha256` and allow `read_file` to return `full` rather than risk returning an unusable `unchanged` or `diff` result.
10. **No cognition claims.** Automatic hash reuse remains a transport/context optimization. It must not change the meaning of `serverEmitted`, `hashConfirmed`, or imply that the model understood or retained the content.

The desired steady-state agent experience is therefore:

```text
read_file(project, path)
```

with the client/runtime handling safe hash reuse when possible, while preserving the existing explicit `known_sha256` interface for compatibility and advanced callers.

## User-visible behavior

### `read_file`

The existing delivery modes remain unchanged:

| Situation | `delivery` | File content resent? |
| --- | --- | --- |
| No matching hash is available | `full` | Yes |
| Caller supplied an older cached hash and a bounded diff is available | `diff` | Only the patch |
| Caller supplied the current hash | `unchanged` | No |

Successful responses gain `deliveryId`:

```json
{
  "delivery": "full",
  "deliveryId": "del_01J...",
  "sha256": "H1",
  "content": "..."
}
```

When the current hash is unchanged, the response reuses the delivery ID for that content version and does not create another content delivery:

```json
{
  "delivery": "unchanged",
  "deliveryId": "del_01J...",
  "sha256": "H1"
}
```

When the file changed, a `diff` or `full` fallback receives a new delivery ID. If the previous content is no longer in the bounded cache, the planner falls back to `full` and reports the existing hash plus `deliveryFallback: "base_not_cached"`.

### `context_delivery_status`

Add a read-only tool with the same resource identity inputs as `read_file`:

```text
context_delivery_status(
  project,
  path,
  start_line?,
  end_line?,
  cwd?
)
```

The tool reads the current file/range to compute its hash, then queries the delivery ledger. It must not record a new delivery and must not return file content.

The response has this shape:

```json
{
  "status": "delivered_hash_confirmed",
  "currentSha256": "H1",
  "lastDeliveredSha256": "H1",
  "lastDelivery": {
    "deliveryId": "del_01J...",
    "mode": "full",
    "serverEmittedAt": "2026-08-22T10:00:00.000Z"
  },
  "evidence": {
    "serverEmitted": true,
    "hashConfirmed": true,
    "modelConsumed": "not_observable"
  },
  "resendRequired": false,
  "recommendedDelivery": "unchanged",
  "knowledgeScope": "session"
}
```

The status values are:

| Status | Meaning | `resendRequired` |
| --- | --- | --- |
| `never_delivered` | No delivery record for this exact resource while the scope marker is active | `true` |
| `delivered_unconfirmed` | The current hash was returned by `read_file`, but no later matching `known_sha256` was observed | `false` |
| `delivered_hash_confirmed` | The current hash was returned and a later request supplied that same hash | `false` |
| `content_changed` | A prior version was delivered, but the current hash differs | `true` |
| `unknown` | The request has no stable session identity, or the local record expired/was evicted | `null` |

`resendRequired` is a server-level answer: `false` means the current bytes do not need to be sent again according to the ledger. It is not a recommendation about whether a model should be reminded. `hashConfirmed` means only that the caller later presented the hash. It is not an assertion that the model consumed the content. `recommendedDelivery` is `unchanged` for either delivered state when the current hash matches, `diff` when the previous base is still cached, `full` when a fresh or fallback delivery is needed, and `unknown` when the scope cannot be trusted.

`knowledgeScope` is `session` when the MCP transport supplied a session ID, `process_local` for the single-client stdio fallback, and `unknown` when neither identity is safe to use.

## Scope and identity

### Delivery scope

Every ledger lookup uses:

```text
scope = sessionId + projectId
resourceKey = resolvedPath + ":" + startLine + "-" + endLine
```

The resolved path is used internally to prevent aliases from colliding; responses continue to expose the existing project-relative path fields. Line defaults must be normalized exactly as `read_file` normalizes them, so a full-file read and a partial-range read are different resources.

### Session resolution

The tool wrapper must pass the MCP callback's `RequestHandlerExtra` through to delivery-aware handlers. The resolver uses `extra.sessionId` as the primary identity.

- Stateful MCP transports use their transport session ID.
- Stdio may use one process-local instance identity because the process has one connected client.
- A stateless request without a stable session identity must return `knowledgeScope: "unknown"` rather than accidentally sharing history between callers.
- The custom tunnel frame schema is unchanged; direct tool executors that bypass the MCP callback context are outside this first implementation's automatic tracking boundary.

The application entry point supplies the transport mode to the resolver so the no-session fallback is allowed only for stdio. A missing session ID on stateless HTTP is never converted into the process-wide fallback.

Session IDs are used as an isolation key only. They are not treated as authorization; existing project and capability checks remain authoritative.

## Ledger design

The ledger stores delivery metadata separately from the optional content cache.

```ts
type DeliveryMode = 'full' | 'diff' | 'unchanged' | 'reference';

interface DeliveryRecord {
  deliveryId: string;
  scopeId: string;
  projectId: string;
  resourceKey: string;
  sha256: string;
  mode: 'full' | 'diff' | 'reference';
  baseSha256?: string;
  serverEmittedAt: number;
  hashConfirmedAt?: number;
  expiresAt: number;
}
```

The content cache is keyed by scope, resource, and hash. It is used only to generate a bounded diff. The delivery record must never contain source content.

The planner needs a two-step outcome:

1. prepare a plan and a delivery ID without treating a failed tool invocation as delivered;
2. mark the plan as server-emitted only after the response has been constructed successfully.

For `known_sha256`:

- if it matches the current hash and a record exists, mark that version's `hashConfirmedAt` and return `unchanged` with the existing delivery ID;
- if it refers to a previously delivered older version, mark that older version hash-confirmed, then deliver the current version as `diff` or `full`;
- if it is not present in this session's ledger, it may still be used for the existing planner comparison, but it must not be counted as confirmation evidence;
- a delivery ID is generated for `full` and `diff`, and reused for `unchanged`.

The ledger keeps a short-lived scope marker separate from resource records. That lets it distinguish an active scope with no delivery (`never_delivered`) from a scope whose metadata was evicted or expired (`unknown`) without retaining source content.

### Limits and expiry

The initial defaults are:

- at most 256 cached resource versions;
- at most 16 MiB of cached source content across all entries;
- 30-minute TTL for metadata and content cache entries;
- lazy expiry on lookup/write plus an explicit clear operation for session cleanup.

If content is evicted but delivery metadata remains, status can still report that a hash was delivered while recommending `full` rather than `diff`. If metadata is expired, the scope marker records that the answer is no longer reliable and status is `unknown`, not `never_delivered`.

No delivery metadata or source content is written to `HANDOFF.md`, `.chat-dev`, activity logs, or any other persistent store.

## Integration boundaries

### Tool registration

The local `registerTool` wrapper currently accepts the callback's rest arguments but the delivery-aware handlers do not consume them. The implementation must preserve all existing handlers while passing the MCP `extra` context to `read_file` and `context_delivery_status`.

`context_delivery_status` must use the existing project lookup, file permission/path-jail, and line-range behavior. Its registry metadata must classify it as a read-only, discoverable tool with the same access boundary as `read_file`.

### Existing `ContextLedger` and `DeliveryPlanner`

The current planner behavior is retained as the compatibility core. Its scope changes from project-only to session-plus-project, and its stored content moves behind the bounded cache. Existing callers and tests that only ask for `full`, `diff`, or `unchanged` must continue to work with the new optional metadata.

### Tunnel protocol

No new tunnel message type, frame field, or acknowledgement handshake is introduced in this slice. This prevents a false claim that the custom tunnel can confirm model consumption before a protocol-level contract exists.

## Security and privacy

- The status tool returns hashes, relative resource metadata, delivery IDs, timestamps, and booleans; never cached source content.
- Existing authorization and path-jail checks run before ledger access.
- A session ID cannot grant access to a project; it only partitions already-authorized history.
- Source content is process-memory only, bounded, expiring, and never persisted by this feature.
- Delivery IDs are opaque random identifiers and must not encode absolute paths, project names, or source content.
- Logs must not include source content or the full ledger. Existing action logs may include tool name and normal request metadata.

## Compatibility and failure behavior

- `known_sha256` remains optional and keeps its current meaning.
- Existing clients may ignore `deliveryId` and continue to use `delivery` and `sha256`.
- A missing cached base changes only the fallback from `diff` to `full`; it must not fail the file read.
- A failed file read or failed tool handler must not create a server-emitted delivery record.
- A status lookup with no stable session identity returns `unknown` with a reason that the scope is unavailable; it must not guess from another session.
- A server restart loses this in-memory history. The status result must identify the knowledge as process-local so callers do not mistake it for durable history.

## Verification requirements

The implementation is complete only when tests cover:

1. first read creates a delivery ID and returns `full`;
2. the same hash returns `unchanged`, does not resend content, reuses the delivery ID, and records hash confirmation;
3. changed content returns `diff` with a new delivery ID when the base is cached;
4. changed content falls back safely to `full` after base eviction;
5. two sessions have independent records for the same project/resource;
6. two projects have independent records inside one session;
7. a status query never returns source content and does not mutate the ledger;
8. status distinguishes never delivered, delivered but unconfirmed, hash-confirmed, changed, and unknown scope;
9. failed reads do not appear as delivered;
10. the new tool is present in the public registry and existing registry coverage remains valid;
11. the existing phase-2 planner behavior remains compatible;
12. TypeScript compilation and the production build pass.

## Deferred protocol evolution

A later version may add an explicit acknowledgement operation, for example `ack_context_delivery(deliveryId)`, or a transport-level acknowledgement frame. That operation must be documented as evidence that the client received/acknowledged a delivery—not as proof that the model understood or retained the source. It is intentionally excluded from this MVP so the current MCP and tunnel contracts remain backward-compatible.
