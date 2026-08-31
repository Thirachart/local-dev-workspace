# 🏛️ MCP v2: Workspace Transaction Layer Design Specification

**Status**: Approved Specification (Implementation Contract)  
**Date**: 2026-08-17  
**Project**: `chat-dev-mcp v2`  
**Architecture Theme**: Workspace Transaction Layer for Coding Agents  
**Baseline**: MCP Native / Secure MCP Tunnel / Windows First / TypeScript + Rust

---

## 1. Executive Summary

`chat-dev-mcp` v2 จะไม่ถูกออกแบบเป็นเพียง command wrapper อีกต่อไป แต่จะทำหน้าที่เป็น **Workspace Transaction Layer** ระหว่าง AI Coding Agent กับ local development workspace โดยมีหน้าที่หลัก 4 ด้าน:

1. ให้ Agent เห็น workspace state แบบ compact และตรวจสอบย้อนหลังได้
2. ป้องกัน stale-context และ multi-session overwrite ด้วย Optimistic Concurrency Control (OCC)
3. ทำ file mutation ผ่าน guarded, fail-loudly pipeline ที่มี authoritative per-file CAS
4. ลด token/roundtrip ด้วย structured output, semantic code intelligence และ context ledger

Primary integration surface คือ **MCP-native connection ผ่าน Secure MCP Tunnel** ไม่ใช่ OpenAPI Actions ดังนั้นข้อจำกัดจำนวน OpenAPI operations ไม่ใช่ design constraint ของ v2

Public MCP tool surface จะถูกออกแบบตาม semantic intent และ safety boundary ไม่ใช่ตามจำนวน operation สูงสุดหรือต่ำสุดแบบตายตัว

---

## 2. Core Engineering Principles

MCP v2 ยึดหลัก 7 ประการ:

1. **Snapshot-Aware** — ทุก operation สำคัญผูกกับ workspace observation ที่ตรวจสอบได้
2. **Optimistic Concurrency Control** — mutation ใช้ workspace observation + authoritative file SHA256
3. **Compact by Default** — ส่งเฉพาะข้อมูลที่จำเป็นต่อการตัดสินใจ
4. **Structured First** — parse compiler/Git/tool output เป็น machine-readable schema ก่อน raw output
5. **Fail Loudly** — stale state, partial parse, conflict และ unsupported platform behavior ต้องเปิดเผย
6. **Deterministic under Stated Preconditions** — ระบุ boundary ของ guarantee อย่างตรงไปตรงมา
7. **No Silent Safety Downgrade** — ห้าม fallback จาก atomic/safe path ไป destructive/non-atomic path เงียบ ๆ

---

## 3. Language & Runtime Decision

### 3.1 Primary language: TypeScript / Node.js

TypeScript/Node.js เป็น implementation language หลักของ MCP v2 เพราะเหมาะกับ:

- `@modelcontextprotocol/sdk`
- runtime schema validation (`zod`)
- TypeScript Compiler API (`Program`, `TypeChecker`)
- Vue SFC parsing (`@vue/compiler-sfc`)
- MCP tool routing และ JSON/schema-heavy orchestration
- cross-platform process and filesystem integration
- maintainability ของ codebase ปัจจุบัน

### 3.2 Native bridge: Rust

Rust ใช้เฉพาะส่วนที่ต้องการ OS-native guarantee หรือ abstraction ที่ Node.js ไม่ควรเป็น correctness boundary เช่น:

- Windows file replacement primitive
- platform-specific file observation ที่ต้องการ stronger semantics
- future low-level filesystem capabilities

Node/Rust boundary ใช้ `napi-rs` หรือ small native helper โดยเลือกวิธีที่ deployment ง่ายที่สุดหลัง prototype

### 3.3 Responsibility split

```text
TypeScript / Node.js
├── MCP protocol / transports
├── schemas / permissions / audit
├── Git intelligence
├── patch planning / CAS orchestration
├── PTY orchestration
├── diagnostics
├── TS/Vue semantic intelligence
└── context economy

Rust native bridge
├── Windows atomic file replacement path
├── native platform capability probes
└── OS-level primitives that require stronger guarantees
```

เป้าหมายคือประมาณ **90–95% TypeScript / 5–10% Rust** ไม่ใช่ native-everything

---

## 4. Platform Strategy

### 4.1 Platform tiers

| Capability | Windows | macOS |
|---|---:|---:|
| MCP server | Tier 1 | Tier 2 |
| Secure MCP Tunnel | Tier 1 | Tier 2 |
| Git intelligence | Tier 1 | Tier 2 |
| File CAS | Tier 1 | Tier 2 |
| Atomic replacement | Tier 1 native path | Tier 2 validated path |
| PTY | ConPTY Tier 1 | Unix PTY Tier 2 |
| Codex CLI | Tier 1 | Tier 2 |
| TypeScript/Vue intelligence | Tier 1 | Tier 2 |
| PowerShell diagnostics | Tier 1 | N/A |
| Bash/zsh diagnostics | Optional | Tier 2 |

Windows เป็น correctness/performance target หลัก ส่วน macOS ต้อง portable แต่ไม่บังคับให้ Windows ลด capability ลงสู่ lowest common denominator

### 4.2 Platform adapter

```ts
export interface PlatformAdapter {
  atomicReplace(request: AtomicReplaceRequest): Promise<AtomicReplaceResult>;
  createPty(options: PtyOptions): PtyProcess;
  observeFilesystem(root: string, options?: ObservationOptions): Promise<FileObservation>;
  normalizePath(input: string): string;
}
```

โครงสร้าง:

```text
src/platform/
├── platformAdapter.ts
├── windows/
│   ├── windowsAdapter.ts
│   └── nativeBridge.ts
└── macos/
    └── macosAdapter.ts

native/
└── platform-bridge/
    ├── Cargo.toml
    └── src/
```

---

## 5. Architectural Layout

MCP v2 มี 5 core execution modules และ 1 cross-cutting Context Economy module

```text
src/
├── core/
│   ├── envelope.ts
│   ├── types.ts
│   ├── snapshotManager.ts
│   ├── permissions.ts
│   ├── auditLogger.ts
│   └── projectRegistry.ts
│
├── mutation/
│   ├── casGuard.ts
│   ├── atomicWriter.ts
│   ├── patchEngine.ts
│   └── fileOps.ts
│
├── git-intel/
│   ├── syncStatus.ts
│   ├── worktrees.ts
│   ├── branchCompare.ts
│   ├── commitService.ts
│   └── branchLifecycle.ts
│
├── execution/
│   ├── shellRunner.ts
│   ├── ptyRunner.ts
│   ├── codexRunner.ts
│   ├── diagParser.ts
│   └── diagnosticBaseline.ts
│
├── code-intel/
│   ├── typescriptProgram.ts
│   ├── vueSfcAst.ts
│   ├── roslynBridge.ts
│   ├── symbolService.ts
│   ├── referenceService.ts
│   └── indexManager.ts
│
├── context/
│   ├── contextLedger.ts
│   ├── deliveryPlanner.ts
│   ├── contentFingerprint.ts
│   └── resultCompressor.ts
│
├── platform/
│   ├── platformAdapter.ts
│   ├── windows/
│   └── macos/
│
└── tools/
    ├── registry.ts
    └── middleware.ts
```

---

## 6. Transaction Granularity

MCP v2 ไม่ใช้ hash เดียวเป็น transaction token สำหรับทุกอย่าง แต่แยก observation ตาม responsibility

### 6.1 Workspace Observation

```text
WorkspaceObservation
└── snapshotId
```

ใช้กับ:

- context consistency
- discovery
- broad stale-state detection
- read-session coordination

### 6.2 File Observation

```text
FileObservation
└── sha256
```

ใช้เป็น **authoritative CAS guard** สำหรับ file mutation

### 6.3 Git Observation

```text
GitObservation
├── HEAD
├── branch/ref identity
└── index fingerprint
```

ใช้กับ:

- commit
- merge
- branch switch/delete
- worktree lifecycle

### 6.4 External process execution

Process execution ไม่ถือว่า atomic transaction

```text
snapshot before
→ execute process
→ snapshot / mutation observation after
```

เพื่อ detect mutation และ classify side effects

---

## 7. Common Request & Response Envelope

ทุก v2 tool ใช้ schema contract เดียว

```ts
export interface CommonRequest {
  schemaVersion: '2.0';
  project?: string;
  cwd?: string;
  expectedSnapshotId?: string;
  staleBehavior?: 'fail' | 'refresh';
  detail?: 'minimal' | 'normal' | 'full';
  maxItems?: number;
  maxChars?: number;
  includeRaw?: boolean;
}
```

Mutation tools ต้อง reject `staleBehavior="refresh"`

```ts
export interface ToolMeta {
  schemaVersion: '2.0';
  operationId: string;
  project: string;
  cwd: string;
  snapshotId?: string;
  snapshotBefore?: string;
  snapshotAfter?: string;
  durationMs: number;
  warnings?: ToolWarning[];
}
```

Error categories:

```text
validation
conflict
permission
execution
internal
```

Representative error codes:

```text
validation:
  UNSUPPORTED_SCHEMA_VERSION
  INVALID_ARGUMENT

conflict:
  STALE_SNAPSHOT
  HASH_MISMATCH
  CONCURRENCY_CONFLICT
  PATCH_CONFLICT
  GIT_CONFLICT

permission:
  PERMISSION_DENIED
  PATH_OUTSIDE_PROJECT

execution:
  COMMAND_FAILED
  TIMEOUT
  PTY_UNAVAILABLE
  READ_ONLY_VIOLATION
  ATOMIC_REPLACE_UNAVAILABLE
  ATOMIC_REPLACE_FAILED

internal:
  INTERNAL_ERROR
```

ห้าม silently coerce unsupported schema version เป็น `2.0`

---

## 8. Workspace Observation Token

`snapshotId` เป็น **Workspace Observation Token** ไม่ใช่ database transaction snapshot

Fingerprint ต้องรวมอย่างน้อย:

```text
project identity
+ branch/ref identity
+ HEAD
+ index fingerprint
+ porcelain status entries
+ hashes of dirty tracked files
+ hashes of untracked files
+ effective instruction-set hashes
```

Rules:

- ignored files ไม่เปลี่ยน normal `snapshotId`
- untracked files เปลี่ยน `snapshotId`
- staged-only changes เปลี่ยน `snapshotId`
- checkout ไป branch คนละชื่อแม้ HEAD เดียวกัน เปลี่ยน `snapshotId`
- instruction set มาจาก `ProjectService.getEffectiveInstructionFiles()` ไม่ hard-code เฉพาะ `CLAUDE.md`/`AGENTS.md`
- Git status parser ใช้ NUL-delimited porcelain output เพื่อลด filename/rename parsing ambiguity

---

## 9. Safe Mutation Contract

### 9.1 Guard model

File mutation ใช้สองระดับ:

```text
expectedSnapshotId   = coarse workspace observation guard
expectedSha256       = authoritative target-file CAS
```

ไฟล์ existing ที่ถูก mutate ต้องมี authoritative `expectedSha256`

### 9.2 Mutation pipeline

```text
Schema validation
        ↓
Resolve project / path jail
        ↓
Permission guard
        ↓
Workspace observation validation
        ↓
Authoritative file SHA256 CAS #1
        ↓
Build complete result in memory
        ↓
Verify newline + untouched byte invariants
        ↓
Write same-directory temp file
        ↓
FileHandle.sync()
        ↓
Authoritative file SHA256 CAS #2
        ↓
PlatformAdapter.atomicReplace()
        ↓
Read-back verification
        ↓
Metadata-only audit
        ↓
Return new hashes + snapshot
```

### 9.3 Windows crash-durability boundary

Temporary replacement data ถูก sync ด้วย `FileHandle.sync()` ก่อน replace

MCP **ไม่เคลม parent-directory crash durability** เกิน guarantee ของ Node/Windows/underlying filesystem

### 9.4 Atomic replace

Windows Tier-1 path ใช้ native replacement primitive ผ่าน Rust bridge เมื่อ validated แล้ว

Rules:

- temp file ต้องอยู่ directory เดียวกับ target
- ห้าม fallback เป็น `unlink(target) -> rename(temp)`
- ห้าม fallback เป็น copy-overwrite
- permanent permission/path/filesystem failure ต้อง fail ก่อน destructive mutation
- transient lock/sharing failures retry แบบ bounded 10ms / 30ms / 60ms
- หลัง retry หมด ให้ `ATOMIC_REPLACE_FAILED`
- target เดิมต้องไม่ถูกทำลายเมื่อ replacement ล้มเหลว

### 9.5 Multi-file boundary

`apply_patch` guarantee **per-file atomicity only**

ไม่มี cross-file ACID transaction หากยังไม่มี Write-Ahead Log

Response ต้องเปิดเผย:

```json
{
  "atomicity": "per-file",
  "completedFiles": ["A.ts", "B.ts"],
  "failedFile": "C.ts"
}
```

ห้ามเคลม rollback ข้ามหลายไฟล์

---

## 10. Permission & Audit Choke Point

Tool handlers ไม่ควรรับผิดชอบ permission check เอง

ทุก tool register ผ่าน descriptor:

```ts
defineTool({
  name: 'apply_patch',
  capability: 'write',
  mutation: true,
  snapshotPolicy: 'required',
  audit: true,
  handler,
});
```

Middleware ordering:

```text
parse schema
→ resolve project/cwd
→ permission check
→ stale/snapshot policy
→ handler
→ mutation audit
→ envelope response
```

DoD สำคัญ: `PERMISSION_DENIED` ต้องเกิด **ก่อน filesystem/process execution**

Audit logger เก็บ metadata เท่านั้น:

```text
operationId
project
actor/session
public tool name
target paths
before hashes
after hashes
snapshot before/after
timestamp
```

ห้ามเก็บ raw source/replacement text โดย default

---

## 11. Execution Engine

### 11.1 PTY

`PtyRunner` ใช้:

- Windows: ConPTY ผ่าน `node-pty`
- macOS: Unix PTY path

Acceptance test ขั้นต่ำ:

```text
node -e "console.log(process.stdin.isTTY)"
Expected inside run_pty: true
```

### 11.2 Codex runner

`codex_run` เป็น domain wrapper บน PTY

Modes:

```text
read-only
edit
```

`read-only` ต้อง enforce ด้วย dedicated mutation observation ไม่ใช่ prompt instruction อย่างเดียว

Normal `snapshotId` ตั้งใจ ignore ignored files ดังนั้น read-only detector ต้องกว้างกว่า normal workspace snapshot และต้อง detect file create/modify ภายใน project root ตาม allowlist/exclusion policy

ถ้าพบ mutation:

```text
READ_ONLY_VIOLATION
```

### 11.3 Compact diagnostics

Compiler/test parser ต้อง structured-first แต่ห้ามกลืน output ที่ไม่รู้จัก

Rule:

```text
exitCode != 0
AND parsed diagnostics == 0
→ unparsedRelevantLines MUST contain diagnostic context
```

รองรับอย่างน้อย:

- MSBuild / CSC
- TypeScript / `tsc`
- `vue-tsc`
- Vitest
- generic nonzero command failure

Baseline warnings ใช้ลด token ของ warnings เดิม แต่ไม่ suppress errors ใหม่

---

## 12. Code Intelligence

### 12.1 TypeScript

ใช้ `ts.createProgram()` + `TypeChecker` สำหรับ semantic analysis จริง

ไม่ใช้ brace parser หรือ text-only matcher เป็น semantic source of truth

### 12.2 Vue

ใช้ `@vue/compiler-sfc` รองรับ:

- `<script>`
- `<script setup>`
- bindings ที่จำเป็นต่อ symbol/reference resolution

### 12.3 C#

วาง Roslyn bridge เป็น architecture boundary สำหรับ:

- symbol extraction
- method/class range
- semantic references

หาก semantic bridge unavailable ต้องระบุ fallback เป็น syntax/text result ไม่เคลมว่า semantic

### 12.4 Index manager

Program/index cache อยู่ใน RAM

Dirty-file overlay ใช้หลีกเลี่ยง full rebuild ทุก tool call

rebuild เมื่อ structural inputs เปลี่ยน เช่น:

- `tsconfig.json`
- project references
- relevant compiler options
- structural file graph change

Warm-path latency เป็น performance objective ไม่ใช่ correctness SLA

---

## 13. Context Economy Module

Context Economy เป็น cross-cutting module ที่ลด token ซ้ำใน long-running coding session

### 13.1 Context Ledger

Ledger จดว่า agent/session เคยได้รับ content version ใดแล้ว

Delivery modes:

```text
full
partial
semantic
patch
diff
unchanged
reference
```

ตัวอย่างครั้งแรก:

```json
{
  "delivery": "full",
  "path": "src/foo.ts",
  "sha256": "aaa",
  "content": "..."
}
```

อ่านซ้ำโดยไฟล์ไม่เปลี่ยน:

```json
{
  "delivery": "unchanged",
  "path": "src/foo.ts",
  "sha256": "aaa",
  "previousOperationId": "op_123"
}
```

เปลี่ยนเฉพาะบางส่วน:

```json
{
  "delivery": "diff",
  "baseSha256": "aaa",
  "sha256": "bbb",
  "patch": "@@ ..."
}
```

### 13.2 Token policy

List/search/diagnostic tools ต้องรองรับ:

```text
maxItems
maxChars
cursor pagination
truncated flag
```

Raw stdout/source content ไม่ควรถูกส่งซ้ำเมื่อ agent มี version เดิมอยู่แล้วและสามารถ reference/diff ได้

---

## 14. Git Intelligence

Git plumbing เป็น source of truth

Capabilities หลัก:

```text
get_git_sync_status
list_worktrees
compare_branches
safe_git_commit
close_feature_branch
```

Git lifecycle mutation ใช้ GitObservation guard แยกจาก file CAS

`list_worktrees` ต้องสามารถเตือน:

```text
CONCURRENT_WORKTREE_ACTIVITY
```

เมื่อมี worktree/session อื่นที่เกี่ยวข้องกับ branch/feature area เดียวกัน

`close_feature_branch` ต้องมี dry-run/verification gate และห้าม push/delete หาก verification fail

---

## 15. Public MCP Tool Strategy

MCP v2 ใช้ MCP-native tool discovery ผ่าน Secure MCP Tunnel เป็น primary integration surface

ดังนั้น:

- ไม่ optimize ตาม OpenAPI 30-operation ceiling
- ไม่ expose internal method ทุกตัวเป็น public tool โดยอัตโนมัติ
- แยก public tool เมื่อ intent/schema/safety boundary ต่างกันจริง
- รวม capability family เมื่อ mental model เดียวกันและไม่ทำให้ model selection คลุมเครือ

ตัวอย่าง standalone tools ที่ควรแยกเพราะมี intent ชัด:

```text
get_project_snapshot
read_file
read_symbol
find_references
apply_patch
git_status
git_diff
compare_branches
compact_diagnostics
suggest_impacted_tests
codex_run
```

Capability-family tools ใช้ได้เมื่อ actions ใกล้กัน เช่น branch management

ไม่มี fixed public tool-count requirement; quality of selection, safety metadata และ compact schema สำคัญกว่าจำนวน

---

## 16. Impacted Test Intelligence

`suggest_impacted_tests` เป็น heuristic tool และ **ไม่ guarantee completeness**

Output ต้องเปิดเผย uncertainty:

```ts
interface ImpactedTestSuggestion {
  completenessGuaranteed: false;
  tests: Array<{
    target: string;
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
  }>;
  fallback: {
    command: string;
    scope: 'project' | 'solution' | 'full';
  };
}
```

Final feature completion gate ยังสามารถ require full suite ได้เสมอ

---

## 17. Compatibility Strategy

v2 envelope/tool migration ต้อง explicit

Rules:

- unsupported schema version ห้าม silently upgrade
- legacy/v1 behavior ถ้ายังเปิดใช้ต้องอยู่ใน compatibility adapter ที่ระบุชัด
- tool registration ต้อง declare capability, mutation status, snapshot policy และ audit policy
- integration conformance ต้อง enumerate registry จริง ไม่ hard-code จำนวน tools

---

## 18. Non-Goals

v2 initial release ไม่พยายาม:

- guarantee complete impacted-test discovery
- สร้าง distributed transaction ข้าม filesystem/Git/process
- ใช้ LLM judgment ใน deterministic mutation path
- silently resolve merge/patch conflicts
- guarantee multi-file ACID transaction โดยไม่มี WAL
- guarantee fixed millisecond SLA สำหรับ semantic indexing
- downgrade atomic mutation ไป non-atomic fallback เพื่อให้ operation สำเร็จ
- optimize architecture ตาม OpenAPI operation limits

---

## 19. Implementation Sequence

ลำดับที่แนะนำ:

1. **Core contract** — envelopes, errors, project isolation, snapshot types
2. **Safe mutation foundation** — CAS, platform adapter, Rust Windows bridge, AtomicWriter, PatchEngine
3. **Permissions + metadata-only audit**
4. **Git Intelligence**
5. **PTY + Codex + compact diagnostics**
6. **TypeScript/Vue/C# Code Intelligence**
7. **Context Ledger / token economy**
8. **Tool registry + compatibility adapter**
9. **Full conformance + Windows torture tests**
10. **macOS compatibility pass**

Tasks 4–7 สามารถแตกย่อย/ทำ parallel หลัง Core/Mutation contracts นิ่งแล้ว

---

## 20. Conformance / Definition of Done

อย่างน้อยต้อง prove:

- [ ] unsupported `schemaVersion` rejected
- [ ] mutation rejects `staleBehavior="refresh"`
- [ ] stale workspace observation detected according to tool policy
- [ ] stale authoritative file hash rejected
- [ ] file modified between initial CAS and replace rejected
- [ ] CRLF stays CRLF and LF stays LF
- [ ] untouched bytes outside patch remain bit-identical
- [ ] multi-file patch reports `atomicity: "per-file"`
- [ ] ignored file does not alter normal snapshot
- [ ] untracked file alters normal snapshot
- [ ] staged-only change alters snapshot
- [ ] branch identity change at same HEAD alters snapshot
- [ ] index fingerprint distinguishes staged content from working-tree content
- [ ] concurrent worktree activity is observable
- [ ] read-only Codex mutation detection covers created/modified project files under its policy
- [ ] `PtyRunner` exposes real TTY (`stdin.isTTY === true`)
- [ ] nonzero compiler failure never disappears silently
- [ ] audit records metadata/hashes only, never raw source
- [ ] permission denial happens before filesystem/process execution
- [ ] Windows atomic replacement failure leaves target unchanged
- [ ] no delete-then-rename/copy-overwrite safety fallback
- [ ] every registered public tool declares capability/mutation metadata
- [ ] every v2 response contains `schemaVersion` and `operationId`
- [ ] legacy compatibility behavior is explicit and tested
- [ ] context ledger returns `unchanged`/`diff` where applicable instead of resending identical content
- [ ] production build passes on Windows Tier 1
- [ ] macOS Tier 2 compatibility suite has explicit pass/fail reporting

---

## 21. Packaging & CI

Repository layout:

```text
chat-dev-mcp/
├── package.json
├── src/
├── native/
│   └── platform-bridge/
│       ├── Cargo.toml
│       └── src/
├── test/
└── dist/
```

Primary CI matrix:

```text
Windows x64      required
macOS arm64      secondary
Windows arm64    later
macOS x64        optional/later
Linux            not priority unless deployment requires it
```

Build stack:

```text
Node.js LTS
TypeScript 5.7+
tsup
zod
@modelcontextprotocol/sdk
@vue/compiler-sfc
node-pty
Rust + Cargo
napi-rs or validated helper bridge
```

---

## 22. Final Architecture Decision

MCP v2 baseline ถูก freeze เป็น:

> **MCP Native / Secure MCP Tunnel / Windows First / TypeScript + Rust / Snapshot-Aware / File-CAS Authoritative / Fail-Loudly / Context-Efficient**

TypeScript เป็น policy/orchestration/intelligence layer และ Rust เป็น native mechanism layer เฉพาะส่วนที่ต้องการ OS-level guarantee

ระบบจะไม่ลด correctness contract เพียงเพื่อให้ operation สำเร็จ และจะเปิดเผย uncertainty/limitations อย่าง explicit ในทุก capability ที่ไม่ deterministic
