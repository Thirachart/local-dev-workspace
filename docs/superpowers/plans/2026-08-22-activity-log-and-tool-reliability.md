# Activity Log and Tool Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every MCP and REST activity safely, remove `codex_run`, and make health/diagnostic/Python test suggestions truthful.

**Architecture:** `ActivityLogStore` owns SQLite persistence and is used only through one shared `Logger`, constructed in `index.ts` and injected into both MCP registration and HTTP transport. Diagnostic status distinguishes a failed command from parsed compiler errors. A small project-tooling resolver selects only verified Node, Python, and .NET commands; unknown projects return no invented command.

**Tech Stack:** Node.js 18+, TypeScript ESM, `better-sqlite3`, Express, MCP SDK, node:test.

**Spec:** `docs/superpowers/specs/2026-08-22-persistent-activity-log-design.md`

## Global Constraints

- Retain activity records indefinitely in `logs/activity.sqlite`; never import `logs/activity.log`.
- Store only redacted, bounded metadata; never persist source content, patches, prompts, command output, handoff bodies, or credentials.
- An activity-store failure must not fail a tool invocation.
- Every externally scoped tool keeps an explicit `project` selector.
- Unknown project tooling must return `null` rather than fabricate `npm test`.

---

### Task 1: Truthful health, diagnostics, and Python impact suggestions

**Files:**
- Modify: `src/services/workspaceHealthService.ts`
- Modify: `src/services/diagnosticService.ts`
- Modify: `src/services/testSuggesterService.ts`
- Modify: `src/transports/sse.ts`
- Test: `test/remaining-project-scope-regression.test.ts`

**Interfaces:**
- Produces `diagnostics.status: 'clean' | 'has_errors' | 'failed' | 'unknown'`.
- Produces `fallbackFullSuiteCommand?: string`; it is absent for unknown tooling.
- Consumes `command?: string` in both the MCP and REST diagnostic paths.

- [ ] **Step 1: Write failing regression cases**

```ts
assert.strictEqual(health.diagnostics.status, 'failed');
assert.strictEqual(health.overallStatus, 'error');
assert.match(health.summary, /command failed.*no parsable/i);
assert.strictEqual(result.fallbackFullSuiteCommand, 'python -m pytest');
assert.deepStrictEqual(result.impactedTests.map((test) => test.testFile), ['tests/test_calculator.py']);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- test/remaining-project-scope-regression.test.ts`

Expected: the new status and Python mapping assertions fail against the current implementation.

- [ ] **Step 3: Implement the smallest truthful behaviour**

```ts
const diagnosticStatus = diagResult.status === 'not_configured'
  ? 'unknown'
  : !diagResult.success && diagResult.errorCount === 0
    ? 'failed'
    : diagResult.errorCount > 0 ? 'has_errors' : 'clean';
```

Pass REST `command` into `runDiagnostics`. Detect Python through `pyproject.toml`, `pytest.ini`, `setup.cfg`, `conftest.py`, or Python source/test files; map `test_<stem>.py` and `<stem>_test.py`, and use `python -m pytest` only when Python is detected.

- [ ] **Step 4: Run focused regression tests and verify GREEN**

Run: `npm test -- test/remaining-project-scope-regression.test.ts`

Expected: all assertions pass.

- [ ] **Step 5: Commit task**

```bash
git add src/services/workspaceHealthService.ts src/services/diagnosticService.ts src/services/testSuggesterService.ts src/transports/sse.ts test/remaining-project-scope-regression.test.ts
git commit -m "fix: make diagnostics and test suggestions truthful"
```

### Task 2: Remove the Codex agent execution surface completely

**Files:**
- Delete: `src/services/agentService.ts`
- Modify: `src/index.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/tools/registry.ts`
- Modify: `src/transports/sse.ts`
- Modify: `src/transports/openapi.ts`
- Modify: `src/tunnel/auth/capabilityResolver.ts`
- Modify: `src/ui/dashboard.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `test/enhanced-core-tools.test.ts`
- Modify: `test/integration-test.ts`

**Interfaces:**
- Removes `codex_run` from every public catalogue and route.
- Removes the unreferenced `AgentService`; retains `node-pty` because the separate execution engine still uses it.

- [ ] **Step 1: Write failing catalogue assertions**

```ts
assert.strictEqual(agent.paths['/api/codex_run'], undefined);
assert.ok(!getPublicToolMetadata().some((tool) => tool.name === 'codex_run'));
```

- [ ] **Step 2: Run the affected OpenAPI test and verify RED**

Run: `npm test -- test/enhanced-core-tools.test.ts`

Expected: the agent-profile assertion fails while the endpoint is still present.

- [ ] **Step 3: Delete every integration seam**

Remove construction/injection, tool registration, REST handler, OpenAPI operation/profile key, dashboard copy/catalogue entry, capability mapping, and the dedicated AgentService test. Retain `node-pty` and its separate execution-engine coverage. Keep unrelated process-management tools unchanged.

- [ ] **Step 4: Run removal and OpenAPI tests and verify GREEN**

Run: `npm test -- test/enhanced-core-tools.test.ts test/integration-removal-regression.test.ts`

Expected: no public `codex_run` reference remains and the suites pass.

- [ ] **Step 5: Commit task**

```bash
git add -A src package.json package-lock.json test
git commit -m "refactor: remove codex agent execution tool"
```

### Task 3: Add durable, redacted activity logging for MCP and REST

**Files:**
- Create: `src/services/activityLogStore.ts`
- Modify: `src/utils/logger.ts`
- Modify: `src/index.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/transports/sse.ts`
- Modify: `src/ui/dashboard.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/activity-log.test.ts`

**Interfaces:**
- `ActivityLogStore.append(event)`, `query(filters)`, `getStats()`, and `close()`.
- `Logger.logAction({ source, action, params, status, durationMs, ... })` with `source: 'mcp' | 'rest'`.
- `GET /logs?json=true` returns cursor-paginated persisted events.

- [ ] **Step 1: Write failing persistence, redaction, and cross-transport tests**

```ts
logger.logAction({ source: 'mcp', action: 'read_file', params: { project: 'temp', content: 'secret' }, status: 'success', durationMs: 1 });
assert.strictEqual(store.query({ limit: 1 }).events[0].params.content, undefined);
assert.strictEqual(store.query({ limit: 1 }).events[0].source, 'mcp');
```

- [ ] **Step 2: Run the activity-log test and verify RED**

Run: `npm test -- test/activity-log.test.ts`

Expected: import or persistence assertions fail before the store exists.

- [ ] **Step 3: Implement store and inject the one Logger**

Create the schema with `PRAGMA user_version = 1`, WAL, indexed cursor queries, and synchronous bounded writes behind a catch-all Logger boundary. Construct the Logger before `registerTools`; wrap every MCP registered handler with a completion/error event. Pass the same Logger into SSE so REST handlers append with `source: 'rest'`. Change Dashboard JSON queries to use durable pagination first and memory only as fallback.

- [ ] **Step 4: Run activity-log tests and verify GREEN**

Run: `npm test -- test/activity-log.test.ts`

Expected: persistence survives Logger recreation, filters/pagination are stable, secrets are absent, and store failures do not fail the caller.

- [ ] **Step 5: Commit task**

```bash
git add src/services/activityLogStore.ts src/utils/logger.ts src/index.ts src/tools/index.ts src/transports/sse.ts src/ui/dashboard.ts package.json package-lock.json test/activity-log.test.ts
git commit -m "feat: persist MCP and REST activity logs"
```

### Task 4: Build, integration verification, and release documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-22-persistent-activity-log-design.md`
- Modify: `docs/superpowers/plans/2026-08-22-activity-log-and-tool-reliability.md`

**Interfaces:**
- Documents `logs/activity.sqlite`, indefinite retention, redaction, and removed `codex_run` surface.

- [ ] **Step 1: Update operator documentation**

Document that activity data is retained indefinitely in SQLite and that deleting the server's `logs/activity.sqlite` is the explicit operator action for disposal; do not claim it contains command output or source content.

- [ ] **Step 2: Run static and focused integration verification**

Run: `npm run build`, `npx tsc --noEmit`, `npm test -- test/remaining-project-scope-regression.test.ts test/enhanced-core-tools.test.ts test/activity-log.test.ts test/integration-removal-regression.test.ts`, and `rg -n "codex_run|AgentService" src test package.json`.

Expected: build/typecheck/tests pass; final search has no executable/public references.

- [ ] **Step 3: Commit release changes**

```bash
git add README.md docs/superpowers/specs/2026-08-22-persistent-activity-log-design.md docs/superpowers/plans/2026-08-22-activity-log-and-tool-reliability.md
git commit -m "docs: document durable activity logging"
```
