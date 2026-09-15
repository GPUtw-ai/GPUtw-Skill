import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GputwClient, type FetchLike } from './client.js';
import { registerTools } from './tools.js';

export const VERSION = '1.1.0-beta.1';
export const USER_AGENT = `gputw-mcp/${VERSION}`;

export interface BuildOptions {
  apiKey?: string;
  apiBase?: string;
  transferBase?: string;
  allowExec?: boolean;
  fetchImpl?: FetchLike;
}

/**
 * Build a configured server. Kept separate from the stdio entrypoint so tests can drive it
 * with an injected fetch and no network.
 */
export function buildServer(opts: BuildOptions = {}): McpServer {
  const client = new GputwClient({
    apiKey: opts.apiKey,
    apiBase: opts.apiBase,
    transferBase: opts.transferBase,
    userAgent: USER_AGENT,
    fetchImpl: opts.fetchImpl,
  });

  const allowExec = opts.allowExec ?? false;
  const server = new McpServer(
    { name: 'gputw', version: VERSION },
    {
      instructions:
        'Tools for the GPUtw GPU cloud (gputw.ai). Deploy order: list-gpus -> ' +
        'list-available-nodes (catalogId from the first) -> list-templates -> create-instance ' +
        '(nodeId from the second) -> poll get-instance-status until RUNNING. Instances bill while ' +
        'RUNNING, so always stop-instance or delete-instance when the work is finished. On ' +
        'get-instance-resources, read usage.source before trusting a metric: "none" means no ' +
        'telemetry and null values, not idle. Persistent files belong in /vault (list-vault, ' +
        'upload-to-vault, download-model-to-vault); /workspace dies with its instance. ' +
        (allowExec
          ? 'exec-in-instance is enabled and runs as root - it is audited, so use it deliberately.'
          : 'exec-in-instance is disabled; set GPUTW_MCP_ALLOW_EXEC=1 to enable running commands inside containers.'),
    }
  );

  registerTools(server, { client, allowExec });
  return server;
}
