# Project Roadmap — WinSpace / `local-dev-tool-mcp`

Updated: 2026-09-14

This roadmap reflects the current MCP-native architecture and the P0–P3 improvement program. Completed capabilities are not kept in the backlog.

## Completed phases

### P0 — Contract & Irreversible Safety ✅

- `snapshotPolicy: required` is enforced in public schemas and runtime.
- Destructive project deletion requires `prepare_project_removal` and a short-lived target-bound confirmation token.
- `write_file` uses atomic replacement with explicit `create_only`, `replace_if_hash`, and `force` modes.
- Public `git_commit` uses the guarded safe-commit path.
- `write_handoff(persist="server")` stores state outside project working trees while legacy workspace handoffs remain readable.

### P1 — Reliability & Registry Safety ✅

- Completed task durations freeze and task/process listing is bounded/filterable.
- Test reporting distinguishes command success from known test counts.
- `add_project` registers existing directories only; `create_project` intentionally creates a directory.
- Structured tool error envelopes coexist with legacy text errors.
- Machine-local `config/projects.json` is ignored; committed bootstrap material lives in `config/projects.example.json` and `config/README.md`.
- Foreground `run_command` timeout now terminates the process by default. Use `detach_on_timeout=true` only when timeout promotion to a trackable background task is intentional.
- TypeScript typecheck is clean.
- The full conformance suite was confirmed to exit normally; the earlier suspected open-handle issue was a long-running test suite rather than a lifecycle leak.

### P2 — Reversibility & Productivity ✅

- Persistent server-state `MutationJournal` with before/after hashes and file backups.
- CAS-safe `undo_operation`; undo refuses targets changed after the recorded mutation.
- `get_mutation` exposes mutation metadata without returning backup content.
- File-only `file_changeset` supports write/edit/delete/move/structured patch with automatic rollback on failure.
- Cross-project `copy_file` and `sync_file` use explicit source/target project identities and optional source SHA256 verification.
- Structured `patch_json` and `patch_yaml` use JSON Pointer set/remove operations.
- `git_stage`, `git_unstage`, and `git_show` provide shell-free Git productivity helpers.
- `batch_file_ops` batches non-mutating read/hash/compare operations.

Reversibility is deliberately limited to file mutations. Shell commands, DB migrations, package installation, Git commits, and external side effects are **not** represented as rollback-safe transactions.

### P3 — Cleanup & Compatibility ✅

- `process_manager` is the canonical background-process lifecycle surface; `task_status`, `task_list`, and `task_kill` remain compatibility aliases during migration.
- MCP-native tool registration remains the primary public contract. HTTP/SSE/OpenAPI remain compatibility transports; `/api/mcp_invoke` can bridge MCP tools without forcing every MCP-native capability into a dedicated REST operation.
- Public tool metadata covers new P2/P3 tools and keeps compatibility mode explicit.
- `project_registry_report` detects missing, duplicate-path, and stale registry entries without exposing absolute paths.
- Documentation now distinguishes trusted shell execution from scoped file operations and no longer lists delivered capabilities as missing.
- JavaScript/JSX symbol/reference support is already available and is not backlog work.

## Architectural constraints

- `run_command` is a trusted-shell capability. Command-pattern checks are defense in depth, **not** a hard sandbox. Hard isolation requires OS/process/container boundaries.
- Absolute local paths should not be exposed to remote clients by default.
- Reversible mutations must be CAS guarded before undo.
- Cross-project operations must name both project identities explicitly and honor project permissions.
- Prefer existing snapshot, atomic-write, safe-Git, and code-intelligence infrastructure over parallel implementations.
- Preserve compatibility through deprecation/migration paths rather than abrupt removal.

## Future backlog

These are optional future capabilities, not unfinished P0–P3 work:

1. Web/documentation fetcher for library docs and reference pages.
2. Agent planning/todo tools for long multi-step workflows.
3. Environment/toolchain diagnostics (`Node`, Python, Go, Rust, Java, .NET, Git, OS/PATH).
4. Jupyter notebook cell-level read/edit support.
5. Optional richer commit preview classifications (protected/generated/include/exclude).
6. OS/container-backed command isolation if a hard shell sandbox becomes a product requirement.
