# Changelog

## Unreleased - 2026-09-14

### Added

- Persistent server-state mutation journal with CAS-safe `undo_operation` and `get_mutation`.
- File-only `file_changeset` with rollback on failed operations.
- Cross-project `copy_file` / `sync_file`, structured `patch_json` / `patch_yaml`, and `batch_file_ops`.
- Git productivity helpers: `git_stage`, `git_unstage`, and `git_show`.
- `project_registry_report` for missing, stale, and duplicate-path registry entries.

### Changed

- Foreground `run_command` timeout terminates by default; `detach_on_timeout=true` explicitly preserves the process as a background task.
- Existing write/edit/delete/move/patch tools now record reversible file mutations when the target is undoable.
- TypeScript baseline errors in SSE and OpenAI tunnel readiness handling were fixed.
- Roadmap and README now distinguish MCP-native capabilities from compatibility aliases/transports.

### Compatibility

- `process_manager` is the canonical background-process lifecycle API; `task_status`, `task_list`, and `task_kill` remain compatibility aliases.
- HTTP/SSE/OpenAPI remain supported as compatibility transports; MCP-native tool registration remains the primary contract.

## 2.0.0 - Local Dev Tool MCP

### Added

- Workspace Transaction Layer
- Session and Workspace Identity
- Capability token validation
- Secure MCP Tunnel foundation
- OpenAPI compatibility gateway model
- Tool catalog discovery

### Changed

- Application renamed from chat-dev-mcp to Local Dev Tool MCP
- Mutations use snapshot/CAS based safety model
- MCP native transport is the primary integration path

### Compatibility

- Existing SSE/OpenAPI integrations remain supported through adapters
