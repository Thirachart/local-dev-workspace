# Local project registry

`projects.json` is local machine state and is intentionally not committed.

To bootstrap a registry for development:

1. Copy `projects.example.json` to `projects.json`.
2. Replace the example project names and paths with directories that exist on your machine.
3. Adjust permissions for each project as needed.

Use `add_project` to register an existing directory. Use `create_project` only when you intentionally want ChatDev MCP to create a new project directory.

Do not put real credentials or machine-specific secrets in the example file.
