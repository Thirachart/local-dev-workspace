# Python unittest Result Parser Design

## Goal

Make `run_tests` report correct structured results when the caller supplies a Python `unittest` command, especially `python -m unittest discover -s tests -v`.

## Current Problem

`TestRunnerService.runTests()` detects a framework from project files before considering `customCommand`. A project containing pytest metadata can therefore label an explicit unittest command as `pytest`. `parseOutput()` then looks for pytest summary syntax and returns zero counts even when unittest reports `Ran 5 tests` followed by `OK`.

The command execution itself is correct. The defect is framework resolution and result parsing.

## Chosen Approach

Resolve the framework from an explicit custom command first, then fall back to project detection only when no custom command was supplied. Use a dedicated unittest parser for standard unittest summary output. Unknown explicit commands receive `framework: "custom"` and are not silently labeled as pytest.

This keeps the existing multi-language detection for automatic commands while preventing project metadata from overriding an explicit user command.

## Framework Resolution

The command detector recognizes the following forms as `unittest`:

- `python -m unittest ...`
- `python3 -m unittest ...`
- `py -m unittest ...`
- equivalent executable paths whose command arguments contain `-m unittest`

When `customCommand` is present, the resolved command returned in `TestRunResult.command` is exactly that command (apart from the existing surrounding trim behavior), and the framework is derived from it. A custom command is not modified by automatic `testFilter` argument injection.

## unittest Parsing Rules

Given output containing:

```text
Ran 5 tests in 0.123s

OK
```

the parser returns `total: 5`, `passed: 5`, `failed: 0`, and `skipped: 0`.

For a failure summary such as:

```text
Ran 5 tests in 0.123s

FAILED (failures=2, errors=1, skipped=1)
```

the parser returns `total: 5`, `failed: 3`, `skipped: 1`, and `passed: 1`. `failures` and `errors` both contribute to the failed count. Expected failures are not counted as failures. Existing failure-location extraction remains available when the command fails.

The parser accepts singular and plural `test/tests`, whitespace variations, and output split across stdout/stderr. It must not overwrite unittest counts with pytest, TAP, or generic parser results after unittest syntax has been recognized.

## Status and Summary

Process exit code remains the source of pass/fail status. A zero exit code with `OK` reports `passed`; a non-zero exit code with unittest failure counts reports `failed`. If the process fails and no structured counts are found, status remains `error` under the existing contract. The summary uses the parsed counts and duration.

## Verification

Tests must cover:

1. Explicit unittest command in a project whose metadata would otherwise detect pytest.
2. `Ran N tests` plus `OK` producing correct counts.
3. `FAILED` with failures, errors, and skipped counts producing correct totals.
4. Custom command framework not being rewritten to pytest.
5. Existing automatic Node, pytest, Go, Rust, and generic behavior remaining intact.

