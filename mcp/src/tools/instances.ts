/** Instance lifecycle and live state. */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { projectInstance } from '../project.js';
import {
  DESTRUCTIVE,
  IDEMPOTENT_WRITE,
  READ_ONLY,
  WRITE,
  guard,
  ok,
  type ToolRuntime,
} from './runtime.js';

const envEntry = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  value: z.string().max(4096),
});

const customImage = z.object({
  dockerImage: z
    .string()
    .describe('Image reference with an explicit non-latest tag or a sha256 digest'),
  registryAuth: z
    .object({ registry: z.string().optional(), username: z.string(), password: z.string() })
    .optional()
    .describe('Private registry credentials; cleared when the instance stops or fails'),
  sshEnabled: z.boolean().optional().describe('Log in as root with the account SSH keys'),
  webUiEnabled: z.boolean().optional(),
  webUiLabel: z.string().max(40).optional(),
  webUiPort: z.number().int().min(1024).max(65535).optional(),
  env: z.array(envEntry).max(32).optional(),
  args: z.array(z.string()).max(64).optional().describe('Replaces the image CMD; ENTRYPOINT is kept'),
});

export function registerInstanceTools(server: McpServer, rt: ToolRuntime): void {
  server.registerTool(
    'list-instances',
    {
      title: 'List instances',
      description:
        'List this account\'s GPU instances (terminated ones are omitted). Billing runs while an ' +
        'instance is RUNNING. Do NOT call this in a polling loop - use get-instance-status for that.',
      annotations: READ_ONLY,
    },
    async () =>
      guard(async () => {
        const list = await rt.client.request<unknown[]>('/instances');
        const running = list.filter((i) => (i as Record<string, unknown>)['status'] === 'RUNNING');
        return ok(
          list.map(projectInstance),
          `${list.length} instance(s); ${running.length} RUNNING and therefore billing.`
        );
      })
  );

  server.registerTool(
    'get-instance-status',
    {
      title: 'Get instance status',
      description:
        'Small, cheap status read built for polling - use this (not list-instances) while waiting for ' +
        'a machine to come up, about every 5 seconds with an overall timeout. Three terminal outcomes: ' +
        'RUNNING (success), FAILED (read get-instance-logs with previous=true), INSUFFICIENT_FUNDS ' +
        '(the user must top up). deployPhase walks SCHEDULING -> PULLING_IMAGE -> STARTING -> RUNNING; ' +
        'large image pulls take minutes. A status that disagrees with podPhase means something is wrong.',
      inputSchema: { instanceId: z.string() },
      annotations: READ_ONLY,
    },
    async ({ instanceId }) =>
      guard(async () => ok(await rt.client.request(`/instances/${instanceId}/status`)))
  );

  server.registerTool(
    'get-instance-resources',
    {
      title: 'Get instance resources and usage',
      description:
        'Allocation, live utilisation and burn rate in one call. Percentages are against the ' +
        "instance's own allocation, not the host. CRITICAL: check `usage.source` first - " +
        '`prometheus` or `fallback` mean the numbers are real; `none` means there is NO telemetry and ' +
        'every metric is null. A null metric is not zero, so never conclude "idle" from it. Machines ' +
        'without GPU telemetry report null gpuPct/vramUsedMib while CPU and RAM still work.',
      inputSchema: { instanceId: z.string() },
      annotations: READ_ONLY,
    },
    async ({ instanceId }) =>
      guard(async () => {
        const d = await rt.client.request<Record<string, unknown>>(
          `/instances/${instanceId}/resources`
        );
        const source = (d['usage'] as Record<string, unknown> | undefined)?.['source'];
        const note =
          source === 'none'
            ? 'No telemetry for this instance (usage.source is "none"): every metric is null, which is NOT the same as idle.'
            : undefined;
        return ok(d, note);
      })
  );

  server.registerTool(
    'get-instance-logs',
    {
      title: 'Get instance logs',
      description:
        'Tail of the container log. Set previous=true to read the container that ran BEFORE the ' +
        'current one - on a crash loop that is the only place the real error appears. tail is capped ' +
        'at 2000 lines and the response at 48 KiB. Infrastructure identifiers are replaced with ' +
        'placeholders (worker-node, [internal-ip]) before the log leaves the server.',
      inputSchema: {
        instanceId: z.string(),
        tail: z.number().int().min(1).max(2000).optional().describe('Lines to return (default 200)'),
        previous: z.boolean().optional().describe('Read the previous container - use this on a crash loop'),
      },
      annotations: READ_ONLY,
    },
    async ({ instanceId, tail, previous }) =>
      guard(async () => {
        const q = new URLSearchParams();
        if (tail !== undefined) q.set('tail', String(tail));
        if (previous) q.set('previous', '1');
        const qs = q.toString();
        const d = await rt.client.request<Record<string, unknown>>(
          `/instances/${instanceId}/logs${qs ? `?${qs}` : ''}`
        );
        const log = d['log'];
        if (!log) return ok(d, 'No log available (the container may not exist yet).');
        return ok(String(log));
      })
  );

  server.registerTool(
    'get-instance-events',
    {
      title: 'Get instance events',
      description:
        'Structured scheduling/startup events for the current container (type, reason, message, ' +
        'count, lastSeen). First stop when a deploy is stuck or FAILED, before reading logs. Events ' +
        'never carry over from a previous container, so an empty list with podExists=false means no ' +
        'container exists yet.',
      inputSchema: { instanceId: z.string(), limit: z.number().int().min(1).max(100).optional() },
      annotations: READ_ONLY,
    },
    async ({ instanceId, limit }) =>
      guard(async () =>
        ok(
          await rt.client.request(
            `/instances/${instanceId}/events${limit ? `?limit=${limit}` : ''}`
          )
        )
      )
  );

  server.registerTool(
    'create-instance',
    {
      title: 'Create instance',
      description:
        'Deploy a GPU instance. Requires the instances:create scope. Supply nodeId from ' +
        'list-available-nodes plus EXACTLY ONE of templateId, template (the docker image string) or ' +
        'customImage. Returns immediately with status DEPLOYING - then poll get-instance-status. ' +
        'Billing starts when it reaches RUNNING (for custom images, from image pull). Deploying needs ' +
        'credit for one hour of every running instance, else 402. Always stop or delete the instance ' +
        'when the work is done.',
      inputSchema: {
        nodeId: z.string().describe('Machine id from list-available-nodes'),
        templateId: z.string().optional().describe('Template id from list-templates'),
        template: z.string().optional().describe('Template docker image, e.g. gputw/pytorch:latest'),
        customImage: customImage.optional().describe('Bring your own image instead of a template'),
        ports: z
          .array(z.number().int().min(1024).max(65535))
          .max(20)
          .optional()
          .describe('HTTP ports to open; 2222, 6443 and 9000-9999 are reserved'),
        bandwidthMbps: z.number().int().optional().describe('Must match a get-deploy-options tier'),
        shmSizeGb: z.number().int().min(1).max(1024).optional(),
      },
      annotations: WRITE,
    },
    async (args) =>
      guard(async () => {
        const chosen = [args.templateId, args.template, args.customImage].filter(
          (v) => v !== undefined
        );
        if (chosen.length !== 1) {
          return ok(
            {},
            'Provide exactly one of templateId, template or customImage. Nothing was deployed.'
          );
        }
        const inst = await rt.client.request<Record<string, unknown>>('/instances/create', {
          method: 'POST',
          body: args,
        });
        return ok(
          projectInstance(inst),
          `Deploying instance ${String(inst['id'])} at $${String(inst['hourlyRate'])}/hr. ` +
            'Poll get-instance-status until RUNNING, and stop or delete it when finished - it bills while running.'
        );
      })
  );

  server.registerTool(
    'stop-instance',
    {
      title: 'Stop instance',
      description:
        'Stop an instance and end compute billing, keeping the record so it can be restarted. ' +
        'Requires instances:manage. The /workspace disk is kept; use this rather than delete when ' +
        'the user may come back to it.',
      inputSchema: { instanceId: z.string() },
      annotations: IDEMPOTENT_WRITE,
    },
    async ({ instanceId }) =>
      guard(async () => {
        const d = await rt.client.request('/instances/stop', {
          method: 'POST',
          body: { instanceId },
        });
        return ok(projectInstance(d), 'Stopped; compute billing has ended.');
      })
  );

  server.registerTool(
    'delete-instance',
    {
      title: 'Delete instance',
      description:
        'Terminate and remove an instance permanently. Requires instances:manage. The /workspace ' +
        'disk is destroyed - anything the user needs must already be in /vault, which is unaffected. ' +
        'Prefer stop-instance when the instance may be needed again. Confirm with the user first.',
      inputSchema: { instanceId: z.string() },
      annotations: DESTRUCTIVE,
    },
    async ({ instanceId }) =>
      guard(async () => {
        const d = await rt.client.request('/instances/delete', {
          method: 'POST',
          body: { instanceId },
        });
        return ok(projectInstance(d), 'Terminated. /workspace is gone; /vault is unaffected.');
      })
  );

  server.registerTool(
    'restart-instance',
    {
      title: 'Restart instance',
      description:
        'Restart a STOPPED or FAILED instance. mode="same" reuses the original machine; ' +
        'mode="alternative" needs a nodeId and creates a NEW instance on another machine. Requires ' +
        'instances:manage. Custom-image instances need a template or the image supplied again, ' +
        'because their registry credentials were cleared on stop.',
      inputSchema: {
        instanceId: z.string(),
        mode: z.enum(['same', 'alternative']),
        nodeId: z.string().optional().describe('Required when mode is "alternative"'),
        templateId: z.string().optional(),
        template: z.string().optional(),
        bandwidthMbps: z.number().int().optional(),
        shmSizeGb: z.number().int().optional(),
      },
      annotations: WRITE,
    },
    async ({ instanceId, ...body }) =>
      guard(async () => {
        if (body.mode === 'alternative' && !body.nodeId) {
          return ok({}, 'mode="alternative" requires a nodeId from list-available-nodes. Nothing was restarted.');
        }
        const d = await rt.client.request(`/instances/${instanceId}/restart`, {
          method: 'POST',
          body,
        });
        return ok(projectInstance(d));
      })
  );

  // Root shell inside the container. Registered only when the operator opted in: it needs the
  // instances:exec scope, which no preset but `full` grants, and every call is audited.
  if (rt.allowExec) {
    server.registerTool(
      'exec-in-instance',
      {
        title: 'Run a command in the instance',
        description:
          'Run ONE command inside a RUNNING instance as root and return stdout, stderr and exitCode. ' +
          'Requires the instances:exec scope. `command` is an argv array handed over verbatim - there ' +
          'is no shell, so nothing is word-split or glob-expanded; for pipes or globs pass ' +
          '["sh","-c","..."]. Output is capped at 256 KiB per stream and the command at timeoutMs ' +
          '(default 30000, max 120000). Every call is written to the account audit trail. Do not use ' +
          'it for long jobs - start them detached and poll instead.',
        inputSchema: {
          instanceId: z.string(),
          command: z.array(z.string().max(4096)).min(1).max(64).describe('argv array, not a shell string'),
          timeoutMs: z.number().int().min(1000).max(120_000).optional(),
        },
        annotations: WRITE,
      },
      async ({ instanceId, command, timeoutMs }) =>
        guard(async () => {
          const d = await rt.client.request<Record<string, unknown>>(
            `/instances/${instanceId}/exec`,
            {
              method: 'POST',
              body: { command, timeoutMs },
              timeoutMs: (timeoutMs ?? 30_000) + 30_000,
            }
          );
          return ok(d, d['truncated'] ? 'Output was truncated at the 256 KiB cap.' : undefined);
        })
    );
  }
}
