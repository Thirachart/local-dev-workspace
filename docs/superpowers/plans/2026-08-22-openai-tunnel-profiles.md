# OpenAI Tunnel Multiple Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named OpenAI Tunnel profiles with safe persistence and one-daemon-at-a-time switching across the service, local UI, HTTP routes, and boot auto-start.

**Architecture:** Keep `OpenAiTunnelService` as the deep lifecycle module and introduce a focused profile-store module for versioned file persistence, migration, profile CRUD, and non-secret summaries. Inject the tunnel-client process seam so lifecycle switching can be tested without downloading or running the real binary. The Dashboard and SSE routes consume the service interface and never receive runtime keys.

**Tech Stack:** TypeScript ESM, Node.js `node:test`, Express, `ChildProcess`, JSON configuration under `config/`, existing Dashboard HTML generator.

**Spec:** `docs/superpowers/specs/2026-08-22-openai-tunnel-profiles-design.md`

## Global Constraints

- Keep the existing ignored `config/tunnel-openai.json` location and migrate legacy top-level `tunnelId`/`runtimeKey` to a `default` profile.
- Run at most one OpenAI `tunnel-client` daemon; switching profiles must wait until the old daemon has actually exited/closed before starting the requested profile. Use a bounded graceful-stop timeout and a forced-kill fallback so a hung child cannot block switching forever.
- Keep persisted tunnel preference authoritative for boot; do not add a tunnel-selection CLI flag.
- Never return or log a complete `runtimeKey`; profile/status responses expose only `runtimeKeyConfigured`.
- Execute `tunnel-client` initialization with an argument-array API such as `execFileSync`/`spawnSync`, never by concatenating a shell command string.
- Serialize profile-store mutations so concurrent add/update/delete/select/config writes cannot lose updates. Use a unique temporary file per write before atomic rename.
- Preserve `/api/ui/tunnel/openai/config`, `/start`, `/stop`, `resolveOpenAiMcpUrl`, and fatal-log behavior for existing callers.
- Keep every OpenAI profile route behind the existing localhost-only UI guard.

### Task 1: Add a versioned, testable OpenAI profile store

**Files:**
- Create: `src/services/openaiTunnelProfileStore.ts`
- Modify: `src/services/openaiTunnelService.ts:8-23,51-102`
- Test: `test/openai-tunnel-service.test.ts`

**Interfaces:**
- Consumes: the existing `config/tunnel-openai.json` path and environment fallback values.
- Produces: `OpenAiTunnelProfile`, `OpenAiTunnelProfileSummary`, `OpenAiTunnelProfilesSnapshot`, and `OpenAiTunnelProfileStore` for the lifecycle module.

- [ ] **Step 1: Write the failing legacy-migration test**

Add a temporary-directory test that writes the current single-profile shape and asserts that a new store returns one `default` profile, selects it, and does not include the runtime key in its summary:

```ts
it('migrates a legacy OpenAI config to a default profile without exposing its key', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openai-profile-store-'));
  const configDir = path.join(root, 'config');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'tunnel-openai.json'),
    JSON.stringify({ tunnelId: 'tunnel_legacy', runtimeKey: 'secret_legacy' }),
    'utf8'
  );

  const store = new OpenAiTunnelProfileStore(path.join(configDir, 'tunnel-openai.json'));
  const snapshot = store.getSnapshot();

  assert.equal(snapshot.activeProfileId, 'default');
  assert.equal(snapshot.profiles[0].tunnelId, 'tunnel_legacy');
  assert.equal(snapshot.profiles[0].runtimeKeyConfigured, true);
  assert.equal('runtimeKey' in snapshot.profiles[0], false);
  await fs.rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test test/openai-tunnel-service.test.ts --test-name-pattern "migrates a legacy"`

Expected: FAIL because `OpenAiTunnelProfileStore` and the versioned snapshot do not yet exist.

- [ ] **Step 3: Implement the smallest profile-store interface**

Create the following types and methods, keeping secret-bearing profile objects internal to the store:

```ts
export interface OpenAiTunnelProfile {
  id: string;
  name: string;
  tunnelId: string;
  runtimeKey: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenAiTunnelProfileSummary {
  id: string;
  name: string;
  tunnelId: string;
  runtimeKeyConfigured: boolean;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenAiTunnelProfilesSnapshot {
  activeProfileId: string;
  profiles: OpenAiTunnelProfileSummary[];
  activeProfile: OpenAiTunnelProfileSummary | null;
}

export class OpenAiTunnelProfileStore {
  constructor(configFile: string, env: Record<string, string | undefined> = process.env);
  getSnapshot(): OpenAiTunnelProfilesSnapshot;
  getActiveProfile(): OpenAiTunnelProfile | null;
  getProfile(id: string): OpenAiTunnelProfile | null;
  async setActiveProfile(id: string): Promise<OpenAiTunnelProfile>;
  async addProfile(input: { name?: string; tunnelId?: string; runtimeKey?: string; description?: string }): Promise<OpenAiTunnelProfileSummary>;
  async updateProfile(id: string, updates: Partial<Omit<OpenAiTunnelProfile, 'id' | 'createdAt' | 'updatedAt'>>): Promise<OpenAiTunnelProfileSummary>;
  async deleteProfile(id: string): Promise<void>;
  async saveActiveCredentials(tunnelId: string, runtimeKey?: string): Promise<void>;
}
```

Load version 2 data directly, migrate legacy data in memory, create a `default` empty profile when no config exists, and write version 2 JSON on every mutation. Serialize every mutating operation through one in-process write queue/mutex so concurrent requests cannot overwrite each other's changes. Each persistence operation must write to its own unique temporary file in the same directory, then atomically rename it over the target so interrupted or overlapping credential saves do not leave truncated JSON or reuse the same temp path.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --import tsx --test test/openai-tunnel-service.test.ts --test-name-pattern "migrates a legacy"`

Expected: PASS with the legacy tunnel ID retained and no `runtimeKey` property in the returned summary.

- [ ] **Step 5: Add CRUD and validation tests one behavior at a time**

Add tests for adding two profiles, selecting the second, updating its name and credentials, refusing an unknown ID, refusing deletion of the last profile, and preserving a runtime key when `updateProfile` receives `runtimeKey: ''`. Add a concurrent-mutation regression that starts two mutations without awaiting the first and verifies both changes are present in the final snapshot/file; also verify each write uses a distinct temporary path before rename. After each test, run its `--test-name-pattern` and implement only the behavior it specifies. The profile ID generator must use only `[a-z0-9_-]` so it is safe for a tunnel-client profile name.

- [ ] **Step 6: Commit the profile-store slice**

Run: `git add src/services/openaiTunnelProfileStore.ts src/services/openaiTunnelService.ts test/openai-tunnel-service.test.ts && git commit -m "feat: add OpenAI tunnel profile registry"`

### Task 2: Refactor OpenAI Tunnel lifecycle around one running profile

**Files:**
- Modify: `src/services/openaiTunnelService.ts:8-17,51-256`
- Test: `test/openai-tunnel-service.test.ts`

**Interfaces:**
- Consumes: `OpenAiTunnelProfileStore` from Task 1.
- Produces: profile-aware `getStatus()`, `getProfiles()`, `setActiveProfile()`, `addProfile()`, `updateProfile()`, `deleteProfile()`, and `startTunnel({ profileId })` behavior.

- [ ] **Step 1: Write the failing status and profile-selection tests**

Assert that `getStatus()` has `activeProfileId`, `runningProfileId`, `tunnelId`, and `runtimeKeyConfigured`, but never has a `runtimeKey` property. Assert that selecting a profile while stopped changes the active ID and that deleting the running profile is rejected.

```ts
it('returns non-secret status and tracks active profile separately from running state', async () => {
  const service = new OpenAiTunnelService(tempRoot);
  const profile = await service.addProfile({ name: 'Work', tunnelId: 'tunnel_work', runtimeKey: 'secret_work' });
  await service.setActiveProfile(profile.id);
  const status = service.getStatus();

  assert.equal(status.activeProfileId, profile.id);
  assert.equal(status.runningProfileId, null);
  assert.equal(status.tunnelId, 'tunnel_work');
  assert.equal(status.runtimeKeyConfigured, true);
  assert.equal('runtimeKey' in status, false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test test/openai-tunnel-service.test.ts --test-name-pattern "non-secret status"`

Expected: FAIL because the current status is single-profile and returns `runtimeKey`.

- [ ] **Step 3: Implement profile delegation and status state**

Replace `tunnelId`/`runtimeKey` fields with the profile store plus `runningProfileId` and `runningMode`. Keep `saveConfig(tunnelId, runtimeKey)` as a compatibility method that updates the active profile; an empty runtime key must retain the stored key. Return `tunnelId` from the running profile while connected and from the active profile while stopped.

- [ ] **Step 4: Add a process seam and unique command-name test**

Add an optional constructor dependency used only by tests:

```ts
export interface OpenAiTunnelRuntime {
  spawnProcess?: typeof spawn;
  initializeProfile?: (binaryPath: string, args: string[], env: NodeJS.ProcessEnv) => void;
  ensureBinary?: () => Promise<string>;
}

// The production constructor keeps its existing first argument and accepts the seam only for tests.
constructor(baseDir?: string, runtime?: OpenAiTunnelRuntime);
```

Production `initializeProfile` must invoke the binary with an argument-array API (`execFileSync`, `spawnSync`, or equivalent) and must not rebuild `args` into a shell command string. Tests should assert the binary path and argument array are forwarded separately.

Export a pure helper with this behavior:

```ts
export function buildOpenAiTunnelClientProfileName(mode: 'http' | 'stdio', profileId: string): string;
// http + prof_work => chat-dev-mcp-http-prof_work
// stdio + prof_work => chat-dev-mcp-stdio-prof_work
```

Test that two profile IDs produce different names and that the generated name contains no spaces or shell metacharacters.

- [ ] **Step 5: Add the failing one-daemon switch test**

Use a fake `ChildProcess` event emitter and injected runtime to assert the observable sequence: start profile A, call `startTunnel({ profileId: B })`, profile A receives `SIGTERM`, profile B is not initialized or spawned yet, then emit A's `exit`/`close`, after which profile B is initialized/run and status reports only B as connected. Add a hung-child case where graceful shutdown exceeds the bounded timeout and the fallback kill path is exercised before B starts. Assert an unknown profile ID is rejected before the current process is stopped.

- [ ] **Step 6: Implement lifecycle switching and process cleanup**

Resolve and validate the requested profile before stopping anything. If a different child is alive, `await stopTunnel()` and make `stopTunnel()` resolve only after the child emits `exit`/`close` or after a bounded graceful-stop timeout triggers the forced-kill fallback and termination is observed. Do not set `child = null` merely because `SIGTERM` was sent. Only after the old process is confirmed gone should the service persist/select the requested profile, initialize it with its tunnel ID and runtime key using the argument-array runtime seam, and spawn exactly one new child using the profile-specific name. Set `runningProfileId` only after spawn succeeds. On exit, clear running state and preserve a non-zero exit error. Do not include credentials in console messages.

- [ ] **Step 7: Run all tunnel-service tests and commit**

Run: `node --import tsx --test test/openai-tunnel-service.test.ts`

Expected: all tunnel URL, log classification, migration, CRUD, status, and lifecycle tests pass.

Commit: `git add src/services/openaiTunnelService.ts test/openai-tunnel-service.test.ts && git commit -m "feat: switch OpenAI tunnel profiles safely"`

### Task 3: Expose profile management through localhost UI routes

**Files:**
- Modify: `src/transports/sse.ts:614-648`
- Test: `test/openai-sse-routing.test.ts`

**Interfaces:**
- Consumes: the profile-aware service interface from Task 2.
- Produces: local-only OpenAI profile CRUD, selection, status, start, stop, and legacy config routes.

- [ ] **Step 1: Add a request-shape regression test**

Export and test a small request normalizer from `sse.ts` so route input cannot accidentally pass arbitrary objects into the service:

```ts
export function getOpenAiTunnelStartRequest(body: unknown): { profileId?: string } {
  const profileId = (body as { profileId?: unknown } | null)?.profileId;
  return { profileId: typeof profileId === 'string' && profileId.trim() ? profileId.trim() : undefined };
}
```

The test must assert that `{ profileId: ' work ' }` becomes `{ profileId: 'work' }` and `{ profileId: 42 }` becomes `{}`.

- [ ] **Step 2: Run the focused routing test and verify RED**

Run: `node --import tsx --test test/openai-sse-routing.test.ts --test-name-pattern "OpenAI tunnel start request"`

Expected: FAIL because the helper is absent.

- [ ] **Step 3: Add the profile routes**

Add these `requireLocalAccess` routes beside the existing OpenAI tunnel routes:

```ts
GET    /api/ui/tunnel/openai/profiles
POST   /api/ui/tunnel/openai/profiles
PUT    /api/ui/tunnel/openai/profiles/:id
DELETE /api/ui/tunnel/openai/profiles/:id
POST   /api/ui/tunnel/openai/profiles/active
```

Validate `name`, `tunnelId`, and `runtimeKey` as strings before calling the service. Return non-secret summaries. Map invalid profile/operation errors to HTTP 400. Update `/api/ui/tunnel/openai/start` to pass `profileId` from `getOpenAiTunnelStartRequest(req.body)`. Keep `/config` as active-profile compatibility and `/status`/`/stop` unchanged except for the new status shape.

- [ ] **Step 4: Add route-contract assertions and commit**

Assert that `start` request normalization is covered and that the route source contains every profile path and `profileId` forwarding. Run:

```text
node --import tsx --test test/openai-sse-routing.test.ts
npx tsc --noEmit
```

Commit: `git add src/transports/sse.ts test/openai-sse-routing.test.ts && git commit -m "feat: expose OpenAI tunnel profile routes"`

### Task 4: Update the Dashboard for safe profile switching

**Files:**
- Modify: `src/ui/dashboard.ts:602-630,1601-1681`
- Test: `test/openai-dashboard.test.ts`

**Interfaces:**
- Consumes: `/api/ui/tunnel/openai/profiles`, `/status`, `/profiles/active`, `/start`, `/stop`, and `/config`.
- Produces: a profile selector, add/edit/delete controls, active-profile display, and one-daemon start/stop controls without secret prefill.

- [ ] **Step 1: Add failing Dashboard contract assertions**

Extend the existing render test to require these stable IDs and route strings: `select-openai-tunnel-profile`, `openai-profile-name-input`, `openai-profile-tunnel-id-input`, `openai-profile-runtime-key-input`, `/api/ui/tunnel/openai/profiles`, and `/api/ui/tunnel/openai/profiles/active`. Also assert the rendered JavaScript does not contain `keyInput.value = status.runtimeKey`.

- [ ] **Step 2: Run the Dashboard test and verify RED**

Run: `node --import tsx --test test/openai-dashboard.test.ts`

Expected: FAIL because the current card has only one credential pair and copies the status runtime key into the input.

- [ ] **Step 3: Implement profile selector and safe status refresh**

Add `openaiProfilesList` and `activeOpenAiProfileId` state, `fetchOpenAiProfiles()`, `renderOpenAiProfilesDropdown()`, and `onOpenAiProfileChange(id)`. Refresh status without copying a runtime key to the DOM. Show `Configured`/`Not configured` from `runtimeKeyConfigured`; leave the password field blank with placeholder `Runtime Key (leave blank to keep)`. Disable the profile selector while the daemon is connected; the user must stop the daemon before selecting a different active profile.

- [ ] **Step 4: Implement add/edit/delete controls**

Add modal handlers that POST/PUT/DELETE the exact profile endpoints. New profile creation requires name, tunnel ID, and runtime key. Editing sends an empty runtime key to retain the existing one. Do not render full or partial runtime-key values in profile lists.

- [ ] **Step 5: Wire Start/Stop to the selected profile and run the contract test**

`toggleOpenAiTunnel()` must POST `{ profileId: activeOpenAiProfileId }` to start and must not save credentials merely because the status refresh ran. Run:

```text
node --import tsx --test test/openai-dashboard.test.ts
npx tsc --noEmit
```

Commit: `git add src/ui/dashboard.ts test/openai-dashboard.test.ts && git commit -m "feat: manage OpenAI tunnel profiles in dashboard"`

### Task 5: Update examples and run the complete verification gate

**Files:**
- Modify: `config/tunnel-openai.example.json`
- Test: `test/openai-tunnel-service.test.ts`, `test/openai-dashboard.test.ts`, `test/openai-sse-routing.test.ts`

- [ ] **Step 1: Update the example to version 2**

Use safe placeholders only:

```json
{
  "version": 2,
  "activeProfileId": "default",
  "profiles": [
    {
      "id": "default",
      "name": "Default",
      "tunnelId": "tunnel_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "runtimeKey": "your_openai_control_plane_runtime_key_here",
      "description": "Primary OpenAI Tunnel",
      "createdAt": "2026-08-22T00:00:00.000Z",
      "updatedAt": "2026-08-22T00:00:00.000Z"
    }
  ]
}
```

- [ ] **Step 2: Run targeted tests and build**

Run:

```text
node --import tsx --test test/openai-tunnel-service.test.ts test/openai-dashboard.test.ts test/openai-sse-routing.test.ts
npx tsc --noEmit
npm run build
```

Expected: exit code `0`, no test failures, and a successful ESM bundle.

- [ ] **Step 3: Run the full conformance suite**

Run: `node --import tsx --test --test-force-exit test/all-conformance.test.ts`

Expected: zero failures. Check specifically that existing OpenAI routing, tunnel-provider, and integration-removal suites remain green.

- [ ] **Step 4: Inspect the final diff and commit the example**

Run `git diff --check` and `git status --short`, verify no runtime credentials or generated `config/tunnel-openai.json` were staged, then commit:

```text
git add config/tunnel-openai.example.json
git commit -m "docs: document OpenAI tunnel profile format"
```
