# MCP v2 Phase 2: Architecture Alignment Plan

> **Status:** Implementation complete locally; Windows Tier-1 native validation delegated to CI  
> **Date:** 2026-08-17  
> **Project:** `chat-dev-mcp`  
> **Baseline:** `pre-v2-stable`  
> **Architecture contract:** `docs/superpowers/specs/2026-08-17-mcp-v2-workspace-transaction-layer-design.md`

## Goal

Align the already-implemented MCP v2 codebase with the latest approved architecture contract without re-implementing completed v2 foundations. This phase focuses only on remaining gaps between the current repository and the frozen baseline:

> **MCP Native / Secure MCP Tunnel / Windows First / TypeScript + Rust / Snapshot-Aware / File-CAS Authoritative / Fail-Loudly / Context-Efficient**

## Execution Principles

- Do not restart historical Tasks 1–9.
- Audit before modifying: each task begins by proving the current gap against the architecture contract.
- Preserve the `pre-v2-stable` tag as a known-good rollback/reference point.
- Use test-first changes for correctness-sensitive platform/mutation code.
- After every code task, run `projectDiagnostics` and focused tests.
- Windows is Tier 1; macOS is Tier 2.
- Never silently downgrade an atomic/safe path to a non-atomic fallback.
- Multi-file patch atomicity remains explicitly **per-file** unless a WAL is introduced later.
- MCP-native/Secure MCP Tunnel is the primary product surface; OpenAPI operation-count limits are not architecture constraints.

---

## Phase 2 Task Graph

```text
Task 1 Current-State Gap Audit
        ↓
Task 2 PlatformAdapter + Capability Probe
        ↓
Task 3 Rust Native Platform Bridge
        ↓
Task 4 AtomicWriter / PatchEngine Alignment
        ↓
 ┌──────┼───────────────┐
 ↓      ↓               ↓
Task 5 Task 6          Task 7
Git     Execution      Code Intelligence
Intel   + MCP Native   Alignment
 └──────┴───────┬───────┘
                ↓
Task 8 Context Economy
                ↓
Task 9 Registry / Compatibility Alignment
                ↓
Task 10 Full Conformance + Windows/macOS Gates
```

Tasks 5–7 may proceed in parallel once Tasks 2–4 establish stable platform/mutation contracts.

---

## Task 1 — Current-State Gap Audit

**Purpose:** Establish an evidence-based map of what is already implemented and what still differs from the architecture contract.

**Create:**
- `docs/superpowers/reviews/2026-08-17-mcp-v2-phase-2-gap-audit.md`

**Audit at minimum:**
- `src/core/`
- `src/mutation/`
- `src/git-intel/`
- `src/execution/`
- `src/code-intel/`
- `src/tools/`
- transports / tunnel configuration
- existing integration tests
- package dependencies/build scripts

**Checklist:**
- [ ] Identify implemented vs missing `PlatformAdapter` behavior
- [ ] Identify current Windows atomic-replacement primitive and failure semantics
- [ ] Verify no delete-then-rename/copy-overwrite safety fallback exists
- [ ] Verify Git commit/lifecycle guards against latest design
- [ ] Verify PTY/Codex read-only mutation observation semantics
- [ ] Verify TypeScript Program/TypeChecker cache and dirty-overlay behavior
- [ ] Verify Vue `<script setup>` coverage
- [ ] Verify Roslyn boundary status
- [ ] Verify Context Ledger / repeated-content suppression status
- [ ] Verify MCP-native/Secure MCP Tunnel primary path vs legacy OpenAPI/SSE paths
- [ ] Enumerate current public tool registry dynamically (no hard-coded count)
- [ ] Record all deviations with severity and proposed task mapping

**Acceptance:** Audit contains file/symbol evidence for each claim and no code mutation beyond the audit document.

---

## Task 2 — PlatformAdapter + Platform Capability Probe

**Purpose:** Introduce a stable cross-platform mechanism boundary without forcing Windows down to lowest-common-denominator behavior.

**Create/Modify:**
- `src/platform/platformAdapter.ts`
- `src/platform/platformFactory.ts`
- `src/platform/windows/windowsAdapter.ts`
- `src/platform/macos/macosAdapter.ts`
- `src/platform/capabilityProbe.ts`
- tests under `test/platform-*`

**Required contracts:**

```ts
interface PlatformAdapter {
  atomicReplace(request: AtomicReplaceRequest): Promise<AtomicReplaceResult>;
  createPty(options: PtyOptions): PtyProcess;
  observeFilesystem(root: string, options?: ObservationOptions): Promise<FileObservation>;
  normalizePath(input: string): string;
}
```

**Checklist:**
- [ ] Detect platform explicitly
- [ ] Expose capability result instead of assuming atomic replacement support
- [ ] Windows adapter uses native bridge when available
- [ ] macOS adapter uses validated POSIX path
- [ ] unsupported capability returns `ATOMIC_REPLACE_UNAVAILABLE`
- [ ] no destructive fallback
- [ ] capability probing has deterministic tests

---

## Task 3 — Rust Native Platform Bridge

**Purpose:** Provide the Windows Tier-1 native mechanism layer for operations where Node.js should not be the correctness boundary.

**Create:**
- `native/platform-bridge/Cargo.toml`
- `native/platform-bridge/src/lib.rs` or helper executable equivalent
- Node binding wrapper under `src/platform/windows/nativeBridge.ts`

**Initial native scope:**
- Windows file replacement primitive (`ReplaceFileW` or another explicitly validated Win32 path)
- normalized structured error mapping
- platform capability probe

**Checklist:**
- [ ] same-volume/same-directory preconditions explicit
- [ ] replacement failure leaves original target intact
- [ ] transient lock errors mapped distinctly from permanent errors
- [ ] bounded retries belong at the TypeScript/platform policy layer unless native implementation materially benefits
- [ ] no raw source content crosses audit/log boundary
- [ ] native bridge packaging works in Windows x64 CI/development
- [ ] macOS does not require Rust path unless validated benefit exists

**Non-goal:** Do not migrate general MCP orchestration into Rust.

---

## Task 4 — Safe Mutation Alignment

**Purpose:** Refactor the existing CAS/AtomicWriter/PatchEngine implementation to consume `PlatformAdapter` and satisfy the latest failure/verification contract.

**Modify:**
- `src/mutation/casGuard.ts`
- `src/mutation/atomicWriter.ts`
- `src/mutation/patchEngine.ts`
- related tests

**Required mutation pipeline:**

```text
schema validation
→ project/path boundary
→ permission guard
→ workspace observation policy
→ authoritative file SHA256 CAS #1
→ construct result in memory
→ preserve newline / untouched-byte invariants
→ same-directory temp write
→ FileHandle.sync()
→ authoritative file SHA256 CAS #2
→ PlatformAdapter.atomicReplace()
→ read-back verification
→ metadata-only audit
→ return hashes/snapshot
```

**Checklist:**
- [ ] existing file mutation requires authoritative SHA256 guard
- [ ] TOCTOU re-check immediately before replacement
- [ ] CRLF/LF preservation retained
- [ ] untouched ranges remain byte-identical
- [ ] replacement failure leaves target unchanged
- [ ] no unlink/copy fallback
- [ ] multi-file response reports `atomicity: "per-file"`
- [ ] completed/failed file reporting is explicit

---

## Task 5 — Git Intelligence Alignment

**Purpose:** Close gaps between current Git tools and the latest GitObservation/lifecycle contract.

**Create/Modify as needed:**
- `src/git-intel/commitService.ts`
- `src/git-intel/syncStatus.ts`
- `src/git-intel/worktrees.ts`
- `src/git-intel/branchCompare.ts`
- `src/git-intel/branchLifecycle.ts`

**Checklist:**
- [ ] safe commit validates expected GitObservation / HEAD/index state
- [ ] branch lifecycle operations reject stale state
- [ ] worktree activity warning is structured
- [ ] branch comparison uses Git plumbing source of truth
- [ ] close-feature flow supports dry-run/verification gates
- [ ] push/delete never occurs after failed verification
- [ ] tests execute only inside isolated temporary Git repositories

---

## Task 6 — Execution + MCP-Native Transport Alignment

**Purpose:** Align PTY/Codex/diagnostics and make MCP-native/Secure MCP Tunnel the primary product path while preserving legacy compatibility explicitly.

**Modify/Create as needed:**
- `src/execution/ptyRunner.ts`
- `src/execution/codexRunner.ts`
- `src/execution/diagParser.ts`
- `src/execution/diagnosticBaseline.ts`
- transport/tunnel integration files

**Checklist:**
- [ ] Windows ConPTY path validated
- [ ] macOS Unix PTY path validated
- [ ] `stdin.isTTY === true` conformance test
- [ ] Codex read-only mode uses dedicated mutation observation broader than normal snapshot semantics
- [ ] ignored-file mutation policy is explicit
- [ ] nonzero command failures preserve `unparsedRelevantLines`
- [ ] diagnostics do not auto-install undeclared tooling
- [ ] MCP-native/Secure MCP Tunnel path documented and preferred
- [ ] legacy SSE/OpenAPI behavior, if retained, is clearly marked compatibility-only
- [ ] no architecture logic depends on OpenAPI operation-count limits

---

## Task 7 — Code Intelligence Alignment

**Purpose:** Ensure semantic code intelligence matches the latest cache/overlay and language-boundary design.

**Modify/Create as needed:**
- `src/code-intel/typescriptProgram.ts`
- `src/code-intel/vueSfcAst.ts`
- `src/code-intel/symbolService.ts`
- `src/code-intel/referenceService.ts`
- `src/code-intel/indexManager.ts`
- `src/code-intel/roslynBridge.ts`

**Checklist:**
- [ ] TypeScript semantic paths use `Program + TypeChecker`
- [ ] Program/index is cached rather than recreated per call
- [ ] dirty-file overlay behavior is explicit and tested
- [ ] structural changes invalidate/rebuild safely
- [ ] Vue `<script>` and `<script setup>` covered
- [ ] Roslyn boundary exists for C# semantic capabilities or explicit syntax-only fallback is reported
- [ ] semantic vs syntax/text fallback is visible in tool response
- [ ] no heuristic result is mislabelled as semantic certainty

---

## Task 8 — Context Economy / Context Ledger

**Purpose:** Reduce repeated source/tool payloads during long coding sessions.

**Create:**
- `src/context/contextLedger.ts`
- `src/context/deliveryPlanner.ts`
- `src/context/contentFingerprint.ts`
- `src/context/resultCompressor.ts`
- focused tests

**Delivery modes:**

```text
full
partial
semantic
patch
diff
unchanged
reference
```

**Checklist:**
- [ ] first delivery can return full/partial content as appropriate
- [ ] identical reread can return `unchanged`
- [ ] changed reread can return bounded `diff`
- [ ] previous `operationId`/content fingerprint can be referenced
- [ ] ledger is session/project isolated
- [ ] maxItems/maxChars/cursor/truncated semantics supported where applicable
- [ ] raw content is not retained longer/more broadly than required
- [ ] stale ledger entries cannot cause incorrect authoritative mutation decisions

**Critical rule:** Context Ledger optimizes delivery only; it must never replace authoritative filesystem/Git/CAS reads for correctness-sensitive operations.

---

## Task 9 — Tool Registry + Compatibility Alignment

**Purpose:** Make tool metadata/security policy explicit and remove assumptions tied to a fixed public tool count.

**Modify/Create:**
- `src/tools/registry.ts`
- `src/tools/middleware.ts`
- registration/conformance tests

**Descriptor model:**

```ts
defineTool({
  name,
  capability,
  mutation,
  snapshotPolicy,
  audit,
  handler,
});
```

**Middleware order:**

```text
parse schema
→ resolve project/cwd
→ permission check
→ snapshot/staleness policy
→ handler
→ mutation audit
→ response envelope
```

**Checklist:**
- [ ] every registered public tool declares security/snapshot metadata
- [ ] registry is enumerated dynamically in tests
- [ ] no hard-coded `44 tools` requirement
- [ ] unsupported schema version is never silently upgraded
- [ ] v1/legacy compatibility behavior is explicit and tested
- [ ] no generic untyped catch-all tool replaces well-defined public intents
- [ ] MCP-native surface is the primary registry target

---

## Task 10 — Full Conformance + Platform Gates

**Purpose:** Prove the final architecture contract rather than merely prove that the bundle builds.

**Required gates:**
- `projectDiagnostics`
- unit tests
- integration tests
- production build
- Git diff/check cleanliness
- Windows Tier-1 platform tests
- macOS Tier-2 compatibility tests

**Conformance checklist:**
- [ ] unsupported schema version rejected
- [ ] mutation rejects `staleBehavior="refresh"`
- [ ] stale workspace observation handled according to tool policy
- [ ] stale target SHA256 rejected
- [ ] TOCTOU change rejected
- [ ] CRLF/LF preserved
- [ ] untouched bytes preserved
- [ ] multi-file atomicity explicitly per-file
- [ ] ignored/untracked/staged snapshot semantics correct
- [ ] branch identity/index fingerprint semantics correct
- [ ] worktree concurrency observable
- [ ] read-only Codex mutation detected
- [ ] real PTY available
- [ ] nonzero diagnostics never disappear silently
- [ ] audit remains metadata-only
- [ ] permission denied before filesystem/process execution
- [ ] Windows replacement failure leaves target untouched
- [ ] no destructive atomicity fallback
- [ ] public registry metadata complete
- [ ] compatibility behavior explicit
- [ ] Context Ledger emits unchanged/diff/reference where applicable
- [ ] Windows Tier-1 required gates pass
- [ ] macOS Tier-2 result is explicitly reported

---

## Definition of Done

Phase 2 is complete only when:

1. the gap audit is closed or every residual deviation is explicitly deferred;
2. the implementation matches the latest architecture contract in all Tier-1 correctness areas;
3. Windows native replacement semantics are validated without unsafe fallback;
4. Context Economy is present without weakening authoritative reads/CAS;
5. MCP-native/Secure MCP Tunnel is the documented primary integration path;
6. public tool registration is metadata-driven and independent of fixed operation counts;
7. Windows Tier-1 conformance passes;
8. macOS Tier-2 compatibility status is known and documented;
9. working tree and Git history remain clean after test execution.

## Suggested Commit Boundaries

Use one commit per completed task when practical:

```text
docs(v2): audit phase-2 architecture gaps
feat(platform): add platform adapter and capability probes
feat(native): add windows native replacement bridge
refactor(mutation): route guarded writes through platform adapter
feat(git-intel): align commit and branch lifecycle guards
feat(execution): align pty codex diagnostics and mcp-native transport
feat(code-intel): align semantic caches overlays and roslyn boundary
feat(context): add context ledger and compact delivery planning
refactor(tools): align registry metadata and compatibility middleware
test(v2): complete windows-first and macos compatibility conformance
```

---

## Execution Result

| Task | Result |
|---|---|
| 1 — Current-State Gap Audit | ✅ Completed — review written under `docs/superpowers/reviews/` |
| 2 — PlatformAdapter + Capability Probe | ✅ Implemented and locally tested on macOS |
| 3 — Rust Native Platform Bridge | ✅ Implemented; Windows compile/runtime validation runs in CI because local macOS host has no Cargo toolchain |
| 4 — Safe Mutation Alignment | ✅ Implemented; CAS/CRLF/per-file atomic/failure-safety tests pass |
| 5 — Git Intelligence Alignment | ✅ Implemented; explicit GitObservation + exact pre-merge rollback |
| 6 — Execution + MCP-Native Transport | ✅ Implemented; content-hash read-only fingerprint and MCP-native docs aligned |
| 7 — Code Intelligence Alignment | ✅ Implemented; compiler-semantic TS references + honest fallback + Roslyn boundary |
| 8 — Context Economy | ✅ Implemented; opt-in known-hash full/unchanged/diff delivery |
| 9 — Registry + Compatibility | ✅ Implemented; all public registrations pass through metadata-driven compatibility choke point |
| 10 — Conformance + Platform Gates | ✅ macOS/local gates pass; Windows Tier-1 native gate configured in `.github/workflows/v2-conformance.yml` and must pass after push |

### Local Verification

- `npm test`: **46/46 passed**
- `npm run test:integration`: **27/27 passed, 0 assertion failures**
- `npx tsc --noEmit`: **0 errors**
- `npm run build`: **passed**
- `git diff --check`: **passed**
- macOS PlatformAdapter/atomic failure tests: **passed**
- Rust `cargo check`: **not runnable on this host (`cargo` not installed); Windows CI is the authoritative native validation gate**
