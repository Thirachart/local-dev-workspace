# MCP v2 Phase 2 Gap Audit

**Date:** 2026-08-17  
**Project:** `chat-dev-mcp`  
**Baseline:** `pre-v2-stable`  
**Architecture contract:** `docs/superpowers/specs/2026-08-17-mcp-v2-workspace-transaction-layer-design.md`

## Executive Summary

The repository already contains the historical v2 Tasks 1–9 and a stable pre-v2 checkpoint. Phase 2 must align the implementation with the later architecture contract rather than re-run the historical plan.

### Severity Summary

| Area | Status | Severity | Evidence |
|---|---|---:|---|
| Core envelope / snapshot / permission / audit | Implemented | Low | `src/core/*` |
| Platform abstraction | Missing | **Blocker** | no `src/platform/` |
| Windows native replace bridge | Missing | **Blocker** | no `native/platform-bridge/` |
| AtomicWriter | Partial | **High** | `src/mutation/atomicWriter.ts` uses direct `fs.rename()` |
| Git intelligence | Mostly implemented | Medium | `src/git-intel/*`, including `commitService.ts` |
| PTY / Codex / diagnostics | Implemented with alignment gaps | Medium | `src/execution/*` |
| TS/Vue code intelligence | Partial semantic implementation | **High** | `referenceService.ts` still uses regex while reporting semantic confidence |
| Context Economy / Ledger | Missing | **High** | no `src/context/` |
| Tool metadata choke point | Partial | **High** | `withV2Envelope` exists but `src/tools/index.ts` directly calls `server.tool` ~47 times |
| MCP-native primary path | Partial | Medium | stdio is default; HTTP path remains named/structured as SSE/OpenAPI compatibility |
| macOS Tier-2 validation | Partial | Medium | current host is macOS and integration suite passes, but no dedicated platform contract tests |

## Detailed Findings

### 1. Core

Implemented:
- strict v2 envelope helpers and categorized failures
- workspace snapshot manager
- project permission guard
- metadata-only audit logger

Alignment note:
- middleware has correct intended ordering but is not yet the single registration choke point for the public MCP tool catalog.

### 2. Platform Layer

**Missing.** There is no `src/platform/` abstraction and no capability probe.

Required Phase 2 action:
- introduce `PlatformAdapter`, `PlatformFactory`, Windows/macOS implementations and explicit capability results.

### 3. Native Windows Replacement

**Missing.** There is no Rust/native platform bridge.

Current `AtomicWriter` performs:

```text
same-directory temp
→ FileHandle.sync()
→ target hash re-check
→ fs.rename(temp, target)
```

It already avoids delete/copy fallback and has bounded retry handling, which should be preserved. However, direct Node `fs.rename()` remains the correctness boundary and must be routed through the platform adapter/native Windows path.

### 4. Safe Mutation

Implemented strengths:
- authoritative SHA256 checks
- TOCTOU re-check
- same-directory temp file
- newline preservation
- fail-loudly error codes
- no explicit unlink-target/copy-overwrite fallback

Gap:
- no `PlatformAdapter.atomicReplace()`
- `AtomicWriter` swallows `FileHandle.sync()` failure (`catch {}`), which weakens fail-loudly semantics
- mutation result does not currently expose replacement capability/provider metadata

### 5. Git Intelligence

Implemented:
- sync status
- worktree inspection
- branch compare/lifecycle
- `commitService.ts`
- snapshot and expected-file-hash guards in safe commit

Alignment gaps:
- Git lifecycle still uses general snapshot semantics rather than an explicit `GitObservation` type
- final conformance must prove lifecycle tests remain isolated in temporary Git repositories

### 6. Execution

Implemented:
- PTY runner
- Codex wrapper
- compact diagnostics and baseline support

Codex read-only implementation currently fingerprints files recursively by `mtimeMs`. It excludes `.git` and `node_modules`, and therefore is broader than normal Git snapshot semantics, but hashing/size metadata would provide stronger mutation detection than mtime alone.

### 7. Code Intelligence

TypeScript:
- `TypeScriptProgramManager` creates a real `Program` and `TypeChecker`
- cache invalidation only compares root-file lists, not compiler configuration/content/structural inputs

References:
- `ReferenceService` creates a TypeChecker but then finds references with regex
- results are marked `semantic: true` and high confidence whenever TypeChecker creation succeeds, even though individual hits are syntax/text matches
- this violates the contract that heuristic/text results must not be presented as semantic certainty

Vue:
- `<script>` and `<script setup>` blocks are extracted with `@vue/compiler-sfc`
- binding analysis is shallow and should use compiler-SFC compilation where needed

C#:
- no `roslynBridge.ts` boundary exists

### 8. Context Economy

**Missing.** No Context Ledger, delivery planner, content fingerprint service or result compressor exists.

Required rule:
- ledger may optimize payload delivery but must never replace authoritative reads/CAS for correctness-sensitive mutations.

### 9. Tool Registry / Middleware

`src/tools/middleware.ts` implements the intended validation → permission → snapshot → handler → audit → envelope flow.

However, `src/tools/index.ts` registers the public catalog directly with `server.tool(...)` (approximately 47 registrations). No `ToolDefinition` metadata registry currently enumerates capability/mutation/snapshot/audit policy for all public tools.

This is a high-priority alignment gap because middleware cannot function as a security choke point if tools bypass it.

### 10. Transport / Product Surface

Current behavior:
- stdio transport is default
- HTTP path is enabled via `--sse` or `--ngrok`
- OpenAPI compatibility transport remains large and active

Phase 2 requirement:
- document and treat MCP-native transport as the primary product path
- retain OpenAPI/SSE compatibility only explicitly
- remove architecture assumptions tied to OpenAPI operation-count limits

### 11. Public Tool Count

The registry should be enumerated dynamically. Current source contains roughly 47 `server.tool(...)` calls; Phase 2 must not encode a fixed count such as “44 tools” in conformance.

## Task Mapping

| Gap | Phase 2 Task |
|---|---|
| Platform abstraction | Task 2 |
| Rust Windows bridge | Task 3 |
| AtomicWriter routing / sync behavior | Task 4 |
| Git observation alignment | Task 5 |
| Codex fingerprint / MCP-native primary path | Task 6 |
| TS/Vue semantic accuracy / Roslyn boundary | Task 7 |
| Context Ledger | Task 8 |
| Metadata-driven tool registry / choke point | Task 9 |
| Cross-platform conformance | Task 10 |

## Audit Conclusion

No historical v2 task should be re-run. The repository is suitable for incremental architecture alignment. The blocking correctness work is the platform/native mutation boundary; the largest semantic-trust gap is reference classification; the largest token-economy gap is the absent Context Ledger; and the largest tool-surface governance gap is direct registration outside the v2 metadata middleware.
