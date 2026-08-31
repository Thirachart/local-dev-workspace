# OpenAI Tunnel Multiple Profiles Design

## Goal

Allow the local server to keep multiple named OpenAI Tunnel credentials and switch between them while running at most one `tunnel-client` daemon at a time.

## Scope

This design covers the OpenAI Tunnel configuration module, daemon lifecycle, local Dashboard controls, startup selection, migration, and secret handling. It does not change the existing tunnel transport protocol or support concurrent OpenAI Tunnel daemons.

## Current Problem

`OpenAiTunnelService` stores one `tunnelId` and one `runtimeKey` in `config/tunnel-openai.json`. The Dashboard also exposes only one pair of inputs. The `tunnel-client` profile name is static, so even replacing the stored credentials would reuse the same client profile. Auto-start can select OpenAI as a provider, but it has no OpenAI profile selection.

The current status response also returns the complete runtime key to the browser. The Dashboard is local-only, but returning a long-lived bearer credential is unnecessary exposure and becomes worse when several credentials exist.

## Chosen Approach

Use a named profile registry in the existing ignored `config/tunnel-openai.json` file. Keep one active profile for persistence and one optional running profile for process state. Starting another profile stops the current daemon before starting the selected one.

The alternative of storing secrets in `config/auth.json` is rejected because that file contains general server preferences and is read by more code. Running multiple daemons concurrently is rejected for this change because it introduces process ownership, port/route ambiguity, and unclear Dashboard semantics without being required by the user.

## Configuration Format

The versioned format is:

```json
{
  "version": 2,
  "activeProfileId": "default",
  "profiles": [
    {
      "id": "default",
      "name": "Default",
      "tunnelId": "tunnel_xxx",
      "runtimeKey": "your_openai_control_plane_runtime_key_here",
      "description": "Primary OpenAI Tunnel",
      "createdAt": "2026-08-22T00:00:00.000Z",
      "updatedAt": "2026-08-22T00:00:00.000Z"
    }
  ]
}
```

`runtimeKey` remains in this local configuration file, which is already ignored by the repository. It must not be copied to `auth.json`, activity logs, API status responses, or profile summaries.

Legacy files containing top-level `tunnelId` and `runtimeKey` migrate in memory and are persisted as a `default` profile when the registry is next saved. Existing `OPENAI_TUNNEL_ID` and `OPENAI_RUNTIME_KEY` environment variables remain a backward-compatible fallback when no version-2 profile registry exists.

## Module Interface

`OpenAiTunnelService` remains the single deep module responsible for profile storage and daemon lifecycle. Its public behavior is extended with:

- `getProfiles()` returns `activeProfileId`, a non-secret profile summary list, and the active summary.
- `setActiveProfile(id)` persists the selected profile. It rejects switching while a different profile is running; callers must stop first or use `startTunnel({ profileId })`.
- `addProfile(data)` creates a stable generated ID and persists a named profile.
- `updateProfile(id, updates)` updates name, credentials, and description. A blank runtime key means retain the existing key during an update.
- `deleteProfile(id)` refuses to delete the last profile and refuses to delete the running profile.
- `saveConfig(tunnelId, runtimeKey)` remains as a compatibility operation that updates the active profile; an empty runtime key retains the existing key so the legacy UI cannot erase it accidentally.
- `startTunnel({ mode, port, sseUrl, profileId })` starts the selected profile, or the active profile when no ID is supplied. If a different profile is currently running, it stops that daemon, selects the requested profile, and starts it.
- `stopTunnel()` stops the single running daemon.

Status responses contain connection state, active/running profile IDs, the running tunnel ID when connected (otherwise the active profile's tunnel ID), whether the relevant runtime key is configured, process details, and errors. They never contain the runtime key value.

## Lifecycle and Startup

There is exactly one `ChildProcess` owned by the module. The running profile ID is explicit, so a saved active profile cannot be confused with the profile currently connected to OpenAI.

Each mode uses a unique `tunnel-client` profile name derived from the selected profile ID, for example `chat-dev-mcp-http-prof_x` and `chat-dev-mcp-stdio-prof_x`. IDs are generated from a restricted identifier alphabet before being inserted into command arguments.

The existing persisted tunnel preference remains authoritative for boot. When it resolves to OpenAI, startup calls `startTunnel()` with the saved active profile. The CLI does not gain a new tunnel-selection flag.

## HTTP/UI Surface

All OpenAI profile routes remain protected by the existing localhost-only UI guard:

- `GET /api/ui/tunnel/openai/profiles`
- `POST /api/ui/tunnel/openai/profiles`
- `PUT /api/ui/tunnel/openai/profiles/:id`
- `DELETE /api/ui/tunnel/openai/profiles/:id`
- `POST /api/ui/tunnel/openai/profiles/active`
- `GET /api/ui/tunnel/openai/status`
- `POST /api/ui/tunnel/openai/config` (compatibility update for the active profile)
- `POST /api/ui/tunnel/openai/start` with optional `profileId`
- `POST /api/ui/tunnel/openai/stop`

The Dashboard gains a profile selector and profile management controls matching the existing Ngrok profile interaction. The runtime-key field is blank on refresh, displays whether a key is configured, and uses an empty value to retain the stored key during edits. The UI never receives the stored secret.

## Error Handling and Safety

- Unknown profile IDs return a client error and do not change the running daemon.
- Starting without both tunnel ID and runtime key returns a clear configuration error.
- Selecting or deleting the running profile is rejected unless the daemon is stopped or explicitly switched through `startTunnel({ profileId })`.
- A failed start records the selected profile and error state but never reports the daemon as connected.
- Profile names and descriptions are metadata only; credentials are not included in logs or summaries.

## Verification

Tests must cover:

1. Legacy single-profile migration to `default`.
2. Add, update, select, and delete profile behavior, including last-profile and running-profile protections.
3. Non-secret profile/status responses.
4. Unique tunnel-client profile names and one-daemon switching behavior through the lifecycle seam.
5. Dashboard and route contracts for profile selection and start requests.
6. Existing auto-start behavior using the persisted active profile.
