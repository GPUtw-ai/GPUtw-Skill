import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCatalogTools } from './tools/catalog.js';
import { registerInstanceTools } from './tools/instances.js';
import { registerVaultTools } from './tools/vault.js';
import type { ToolRuntime } from './tools/runtime.js';

export type { ToolRuntime } from './tools/runtime.js';

/** Register the whole tool surface, grouped by resource. */
export function registerTools(server: McpServer, rt: ToolRuntime): void {
  registerCatalogTools(server, rt);
  registerInstanceTools(server, rt);
  registerVaultTools(server, rt);
}
