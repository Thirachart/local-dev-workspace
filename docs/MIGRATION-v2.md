# Local Dev Tool MCP v2 Migration

## Rename

`chat-dev-mcp` is renamed to `Local Dev Tool MCP`.

Package:

- old: `chat-dev-mcp`
- new: `local-dev-tool-mcp`

## Transport strategy

Primary:

- MCP stdio for local agents
- Secure MCP Tunnel for remote secure access

Compatibility:

- SSE transport remains supported
- OpenAPIAdapter remains supported through generic MCP invocation

## v2 request model

Mutation requests should include:

- sessionId
- capabilityToken
- expectedSnapshotId
- expectedSha256 (file mutations)

All mutations pass through workspace transaction guards.

## Compatibility

Existing integrations can continue using OpenAPI/SSE adapters while migrating to MCP native tools.
