/** Catalogue and capacity: what can be rented, and where there is room right now. */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { projectGpu, projectNode, projectTemplate } from '../project.js';
import { READ_ONLY, guard, ok, type ToolRuntime } from './runtime.js';

export function registerCatalogTools(server: McpServer, rt: ToolRuntime): void {
  server.registerTool(
    'list-gpus',
    {
      title: 'List GPU catalogue',
      description:
        'List GPU models available on GPUtw with live pricing and demand. Start here when deploying: ' +
        'take the `id` of the model you want and pass it to list-available-nodes as catalogId. ' +
        '`liveRentablePrice: null` or `demandStatus: "售罄"` (sold out) means nothing is free right now. ' +
        '`rentalMode: "CONTACT_LONG_SESSION"` cannot be deployed via API - the user must email contactEmail. ' +
        'Prices are USD/hour; credits are charged in TWD. Returns the decision-relevant fields only.',
      annotations: READ_ONLY,
    },
    async () =>
      guard(async () => {
        // Public endpoint - deliberately unauthenticated so it works before a key is set.
        const gpus = await rt.client.request<unknown[]>('/gpus/active', { auth: false });
        return ok(gpus.map(projectGpu), `${gpus.length} GPU models in the catalogue.`);
      })
  );

  server.registerTool(
    'list-available-nodes',
    {
      title: 'List available machines',
      description:
        'List machines currently rentable for one GPU model. Pass the `id` from list-gpus as catalogId. ' +
        'Use a returned machine `id` as the nodeId for create-instance. Only one instance may run per ' +
        'machine, so `availableGpus: 0` or a non-zero queueDepth means it is occupied. Check that the ' +
        'machine `arch` (amd64 / arm64) is in the chosen template\'s architectures. An empty list means ' +
        'no capacity for that model right now. `hostname` is a public label, not a real host.',
      inputSchema: { catalogId: z.string().describe('GPU catalogue entry id, from list-gpus') },
      annotations: READ_ONLY,
    },
    async ({ catalogId }) =>
      guard(async () => {
        const nodes = await rt.client.request<unknown[]>(
          `/nodes/available?catalogId=${encodeURIComponent(catalogId)}`
        );
        if (nodes.length === 0) {
          return ok(
            [],
            'No machines are free for this GPU model right now. Offer the user another model from ' +
              'list-gpus, or the capacity queue (reservations, dashboard).'
          );
        }
        return ok(nodes.map(projectNode), `${nodes.length} machine(s) available.`);
      })
  );

  server.registerTool(
    'list-templates',
    {
      title: 'List workspace templates',
      description:
        'List the prebuilt container templates (PyTorch/Jupyter, ComfyUI, vLLM, Ollama, Ubuntu, CUDA, ' +
        'DGX Spark variants). Pass a template `id` as templateId to create-instance. Never hardcode ' +
        'these ids - they change. `architectures` must contain the target machine\'s arch (DGX Spark ' +
        'machines are arm64). `minComputeCapability` above the machine\'s GPU is rejected at deploy time.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Case-insensitive substring match on the template name, e.g. "PyTorch"'),
        arch: z
          .enum(['amd64', 'arm64'])
          .optional()
          .describe('Only return templates supporting this machine architecture'),
      },
      annotations: READ_ONLY,
    },
    async ({ search, arch }) =>
      guard(async () => {
        const all = await rt.client.request<Record<string, unknown>[]>('/templates', { auth: false });
        const filtered = all.filter((t) => {
          const name = String(t['name'] ?? '');
          const archs = (t['architectures'] as string[] | undefined) ?? [];
          if (search && !name.toLowerCase().includes(search.toLowerCase())) return false;
          if (arch && !archs.includes(arch)) return false;
          return true;
        });
        return ok(filtered.map(projectTemplate), `${filtered.length} of ${all.length} templates match.`);
      })
  );

  server.registerTool(
    'get-deploy-options',
    {
      title: 'Get deploy options',
      description:
        'Bandwidth tiers accepted by create-instance. `bandwidthMbps` must be one of the returned ' +
        'bandwidthOptions values (the included one is free; others are billed per Mbps-hour). ' +
        'Omitting bandwidthMbps on create uses the included tier.',
      annotations: READ_ONLY,
    },
    async () =>
      guard(async () => ok(await rt.client.request('/config/deploy', { auth: false })))
  );
}
