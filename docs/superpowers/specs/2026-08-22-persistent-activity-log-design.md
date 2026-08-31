# Persistent Activity Log Design

## Goal

Record every MCP and REST tool invocation in one durable local log that remains queryable after server restarts and is visible in the Dashboard. Logs are retained indefinitely.

This release also removes the unneeded `codex_run` execution surface and makes diagnostic/test suggestions truthful for Python and unknown projects. These are part of the same reliability release because the Dashboard must only catalogue and persist actions that are actually available.

## Decision

Use SQLite through `better-sqlite3`, stored at `logs/activity.sqlite`.

SQLite fits the local, single-user server: it is transactional, requires no separate service, supports indexed filtering and pagination, and keeps the data beside the existing server logs. The database will use WAL journal mode so dashboard reads do not block normal append operations.

The existing `logs/activity.log` remains an untouched archive. It is not imported because it contains unstructured historical parameter data that may include credentials.

## Module Interface

`ActivityLogStore` is the sole persistence module. Its public interface is deliberately small:

- `append(event)` stores one already-sanitized event.
- `query(filters)` returns cursor-paginated events and a total count.
- `getStats()` returns aggregate counters required by the Dashboard.
- `close()` checkpoints and closes the database during orderly shutdown.

Callers do not know SQL, schema details, indexes, WAL configuration, or retry behavior.

## Data Model

`activity_events` stores one record per completed invocation:

| Column | Meaning |
| --- | --- |
| `id` | Monotonic SQLite row id used as the pagination cursor. |
| `timestamp_ms` | UTC epoch milliseconds at completion. |
| `source` | `mcp` or `rest`. |
| `action` | Registered tool/action name. |
| `project` | Explicit project selector when provided. |
| `target` | Redacted, bounded path/command/query label for the UI. |
| `category` | Existing read/write/test/build/git/command classification. |
| `status` | `success` or `error`. |
| `duration_ms` | End-to-end handler duration. |
| `params_json` | Sanitized metadata only. |
| `result_summary` | Sanitized, bounded result description. |
| `error` | Sanitized, bounded error description. |

Indexes: `(timestamp_ms DESC)`, `(action, timestamp_ms DESC)`, `(project, timestamp_ms DESC)`, and `(status, timestamp_ms DESC)`.

There is no retention deletion job. `VACUUM` is not run automatically because it is disruptive and does not reduce an append-only database that is intentionally retained forever.

## Logging Flow

`index.ts` creates exactly one `Logger` and passes it to both transport setup and `registerTools`.

The registered-tool wrapper is the MCP seam. It records one event for every MCP call after the handler completes, including permission, snapshot, validation, and handler failures. REST handlers use that same Logger and label events with `source: rest`.

This gives the Dashboard one event per external invocation and prevents the current split where REST calls appear while MCP calls are only written to the mutation audit log.

## Redaction and Payload Limits

Persistent activity logs are operational metadata, not an archive of user source or credentials.

Before persistence, the Logger removes values for keys that indicate secrets, including API keys, bearer tokens, authorization, passwords, runtime keys, and tunnel credentials. It removes file contents, patches, prompts, command output, and handoff bodies. Strings are capped and nested values are depth/entry limited. The target label may retain a bounded file path or command name, but not command output.

The Dashboard never receives unredacted raw arguments.

## Dashboard Contract

`GET /logs?json=true` and the UI log feed accept optional `cursor`, `limit`, `action`, `project`, `status`, `source`, `from`, and `to` filters. Results are newest first and include `nextCursor` and `totalCount`.

The initial Dashboard load reads durable history. Subsequent polling uses the cursor, so it does not repeatedly download the complete event history.

## Failure Behavior

An activity-log write must not turn a successful tool invocation into a failed tool invocation. If SQLite is unavailable, Logger emits a local console error and retains a bounded in-memory fallback for the live Dashboard. The server continues operating.

Database initialization or migration failure is surfaced prominently at server startup. The existing log file remains intact for recovery.

## Packaging and Migration

`better-sqlite3` is a native dependency. The Windows app build must package its compiled binding, and CI/build verification must exercise that dependency under the supported Node runtime.

Schema migrations use SQLite `PRAGMA user_version` and execute transactionally. The first release creates schema version 1. Existing `activity.log` is preserved but not parsed.

## Verification

Tests cover:

1. An MCP `tools/call` produces one durable event visible from the Dashboard query.
2. A REST action produces one event with `source: rest`.
3. Events survive a Logger/store re-creation against the same database.
4. Sensitive arguments and source content are redacted before persistence.
5. Cursor pagination and filters return stable, newest-first results.
6. A store write failure does not fail the underlying tool call.
7. `codex_run` is absent from the MCP registry, REST routes, OpenAPI profiles, Dashboard catalogue, and capability resolver.
8. A failed diagnostic command with no parseable compiler errors is reported as `failed`, never as healthy.
9. REST and MCP diagnostics both honour an explicit custom command.
10. Python impact suggestion recognises `tests/test_<module>.py` and returns a Python command; an unknown project returns no fabricated `npm test` fallback.
