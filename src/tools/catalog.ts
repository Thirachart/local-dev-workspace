import { listPublicToolMetadata } from './registry.js';

export function getToolCatalog() {
  return {
    schemaVersion: '2.0',
    tools: listPublicToolMetadata().map((tool) => ({
      name: tool.name,
      mutation: tool.mutation,
      capability: tool.capability,
      requiresSnapshot: tool.snapshotPolicy === 'required',
      compatibility: tool.compatibility,
    })),
  };
}
