# Python unittest Result Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `run_tests` identify explicit Python `unittest` commands and return correct passed, failed, skipped, and total counts from unittest output.

**Architecture:** Keep `TestRunnerService` as the public deep module. Add small pure command-resolution and unittest-parsing seams inside the module so tests can exercise behavior without starting a real test process. `runTests()` resolves an explicit custom command before project metadata and gives recognized output to exactly one framework parser.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, existing `ProcessService` adapter, regex-based parsing of stdout/stderr.

**Spec:** `docs/superpowers/specs/2026-08-22-unittest-result-parser-design.md`

## Global Constraints

- An explicit `customCommand` always has precedence over automatic project detection.
- Recognize `python -m unittest`, `python3 -m unittest`, `py -m unittest`, and executable-path variants only when the first executable token is a supported Python launcher (`python`, `python3`, `py`, versioned `pythonX[.Y]`, or a path whose basename is one of those, optionally `.exe`). Do not classify arbitrary commands that merely contain `-m unittest`.
- Parse `Ran N test/tests`, `OK`, `FAILED`, `failures=X`, `errors=Y`, and `skipped=Z` from merged output.
- For unittest output, do not allow pytest, TAP, or generic fallback parsing to overwrite recognized counts.
- Do not append automatic `testFilter` arguments to an explicit custom command.
- Preserve existing automatic detection and parsers for Node, pytest, Go, Rust, Java, PHP, and generic projects.

### Task 1: Add command-first framework resolution

**Files:**
- Modify: `src/services/testRunnerService.ts:49-105,192-242`
- Test: `test/enhanced-core-tools.test.ts`

**Interfaces:**
- Consumes: an optional explicit command string and the existing project-directory detector.
- Produces: `detectFrameworkFromCommand(command)` and command-first framework resolution used by `runTests()`.

- [ ] **Step 1: Write the failing command detector tests**

Add public behavior tests for the supported command forms and an unknown custom command:

```ts
it('detects unittest from an explicit command before project metadata', () => {
  assert.equal(testRunnerService.detectFrameworkFromCommand('python -m unittest discover -s tests').framework, 'unittest');
  assert.equal(testRunnerService.detectFrameworkFromCommand('python3 -m unittest').framework, 'unittest');
  assert.equal(testRunnerService.detectFrameworkFromCommand('py -m unittest discover').framework, 'unittest');
  assert.equal(testRunnerService.detectFrameworkFromCommand('C:\\Python312\\python.exe -m unittest').framework, 'unittest');
  assert.equal(testRunnerService.detectFrameworkFromCommand('"C:\\Program Files\\Python312\\python.exe" -m unittest').framework, 'unittest');
  assert.equal(testRunnerService.detectFrameworkFromCommand('custom-runner --tests').framework, 'custom');
  assert.equal(testRunnerService.detectFrameworkFromCommand('custom-runner -m unittest').framework, 'custom');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test test/enhanced-core-tools.test.ts --test-name-pattern "detects unittest"`

Expected: FAIL because the command detector does not exist.

- [ ] **Step 3: Implement command detection and precedence**

Add:

```ts
public detectFrameworkFromCommand(command: string): { framework: string; command: string } {
  const normalized = command.trim();
  const executableMatch = normalized.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  const executablePath = executableMatch?.[1] || executableMatch?.[2] || executableMatch?.[3] || '';
  const executableName = executablePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
  const isPythonLauncher = /^(?:py|python\d*(?:\.\d+)*)(?:\.exe)?$/i.test(executableName);
  const isUnittestModule = /(?:^|\s)-m\s+unittest(?:\s|$)/i.test(normalized);

  if (isPythonLauncher && isUnittestModule) {
    return { framework: 'unittest', command: normalized };
  }
  return { framework: 'custom', command: normalized };
}
```

In `runTests()`, resolve `options.customCommand` first. Use `detectFrameworkFromCommand(customCommand)` when present; otherwise use the existing `detectFramework(cwd)`. Preserve the exact custom command and keep `testFilter` injection guarded by `!options.customCommand`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --import tsx --test test/enhanced-core-tools.test.ts --test-name-pattern "detects unittest"`

Expected: PASS for all supported Python launcher forms, including quoted/unquoted Windows executable paths, and PASS for the negative regression proving `custom-runner -m unittest` remains `custom`.

- [ ] **Step 5: Commit the command-resolution slice**

Run: `git add src/services/testRunnerService.ts test/enhanced-core-tools.test.ts && git commit -m "fix: prioritize explicit test commands"`

### Task 2: Add a dedicated unittest output parser

**Files:**
- Modify: `src/services/testRunnerService.ts:107-190`
- Test: `test/enhanced-core-tools.test.ts`

**Interfaces:**
- Consumes: merged stdout/stderr and framework name `unittest`.
- Produces: parsed counts and failure details through the existing `parseOutput()` return shape.

- [ ] **Step 1: Write the passing-summary regression test**

Add this exact output case:

```ts
it('parses unittest OK output', () => {
  const parsed = testRunnerService.parseOutput(
    'Ran 5 tests in 0.123s\\n\\nOK\\n',
    'unittest'
  );
  assert.deepEqual(parsed, { passed: 5, failed: 0, skipped: 0, failures: [] });
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run: `node --import tsx --test test/enhanced-core-tools.test.ts --test-name-pattern "parses unittest OK"`

Expected: FAIL with zero counts because the current parser has no unittest branch.

- [ ] **Step 3: Implement the minimal unittest parser branch**

Before TAP, Vitest/Jest, pytest, and generic parsing, add a branch that runs only when `framework === 'unittest'`:

```ts
const ranMatch = output.match(/\bRan\s+(\d+)\s+tests?\b/i);
const failedSummary = output.match(/\bFAILED\b(?:\s*\(([^)]*)\))?/i);
const okSummary = /(?:^|\n)\s*OK(?:\s|\(|$)/i.test(output);
if (!ranMatch && !failedSummary && !okSummary) {
  return { passed: 0, failed: 0, skipped: 0, failures: [] };
}
const total = ranMatch ? Number(ranMatch[1]) : 0;
const failuresCount = Number(output.match(/\bfailures=(\d+)\b/i)?.[1] || 0);
const errorsCount = Number(output.match(/\berrors=(\d+)\b/i)?.[1] || 0);
const skipped = Number(output.match(/\bskipped=(\d+)\b/i)?.[1] || 0);
const failed = failuresCount + errorsCount;
const passed = Math.max(total - failed - skipped, 0);
```

Return immediately from this branch so later parser families cannot overwrite its values. Use `failedSummary`/`okSummary` to preserve the parsed counts for standard unittest output and keep the existing failure-location extraction for `failed > 0`.

- [ ] **Step 4: Add the failure-summary regression test**

Write and run a test for:

```text
Ran 5 tests in 0.123s

FAILED (failures=2, errors=1, skipped=1)
```

Expected parsed result: `passed: 1`, `failed: 3`, `skipped: 1`, with no negative count.

- [ ] **Step 5: Add singular/whitespace coverage and commit**

Test `Ran 1 test`, `OK`, and whitespace variations. Run:

```text
node --import tsx --test test/enhanced-core-tools.test.ts --test-name-pattern "unittest"
```

Commit: `git add src/services/testRunnerService.ts test/enhanced-core-tools.test.ts && git commit -m "fix: parse Python unittest results"`

### Task 3: Verify end-to-end custom-command result selection

**Files:**
- Modify: `test/enhanced-core-tools.test.ts`
- Verify: `src/services/testRunnerService.ts`

**Interfaces:**
- Consumes: command-first resolution and unittest parser from Tasks 1-2.
- Produces: a `TestRunResult` that reports `framework: "unittest"`, the exact custom command, and correct structured counts even inside a pytest-configured project.

- [ ] **Step 1: Add a fake process adapter test**

Use a temporary project containing `pytest.ini` and a fake `ProcessService` with this public behavior. Create and remove the temporary directory inside the test:

```ts
const fakeProcessService = {
  runCommand: async () => ({
    exitCode: 0,
    stdout: 'Ran 5 tests in 0.123s\\n\\nOK\\n',
    stderr: '',
  }),
} as unknown as ProcessService;

const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unittest-project-'));
await fs.writeFile(path.join(projectDir, 'pytest.ini'), '[pytest]\n', 'utf8');
```

Call:

```ts
const result = await new TestRunnerService(fakeProcessService, projectDir).runTests({
  customCommand: 'python -m unittest discover -s tests -v',
});
```

Assert `framework === 'unittest'`, `command` is the exact custom command, `passed === 5`, `failed === 0`, `skipped === 0`, `total === 5`, and `status === 'passed'`.

- [ ] **Step 2: Run the end-to-end regression and verify it passes**

Run: `node --import tsx --test test/enhanced-core-tools.test.ts --test-name-pattern "custom unittest"`

Expected: PASS and no invocation of pytest in the fake adapter.

- [ ] **Step 3: Verify unknown custom commands do not inherit pytest**

Add a fake nonzero result for `custom-runner --tests` and assert `framework === 'custom'`; when output has no recognized counts, assert the existing `status: 'error'` behavior remains.

- [ ] **Step 4: Commit the end-to-end slice**

Run: `git add test/enhanced-core-tools.test.ts && git commit -m "test: cover custom unittest result contract"`

### Task 4: Run regression and completion verification

**Files:**
- Verify: `src/services/testRunnerService.ts`, `test/enhanced-core-tools.test.ts`, and all existing test suites.

- [ ] **Step 1: Run targeted parser tests**

Run: `node --import tsx --test test/enhanced-core-tools.test.ts --test-name-pattern "test|unittest|generic"`

Expected: zero failures, including the existing Node TAP and generic-project tests.

- [ ] **Step 2: Run typecheck and build**

Run:

```text
npx tsc --noEmit
npm run build
```

Expected: exit code `0` for both commands.

- [ ] **Step 3: Run the full conformance suite**

Run: `node --import tsx --test --test-force-exit test/all-conformance.test.ts`

Expected: zero failures and no regression in `run_tests`, diagnostics, project scope, or OpenAI routing suites.

- [ ] **Step 4: Inspect diff and commit only intended files**

Run `git diff --check` and `git status --short`. Confirm no generated config or credentials are staged, then make the final parser integration commit:

```text
git add src/services/testRunnerService.ts test/enhanced-core-tools.test.ts
git commit -m "fix: report Python unittest counts correctly"
```
