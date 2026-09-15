/** Vault storage: browse, and get files in - by chunked upload or a server-side fetch. */
import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { projectVaultEntry } from '../project.js';
import { READ_ONLY, WRITE, guard, ok, type ToolRuntime } from './runtime.js';

const POLL_MS = 2000;

export function registerVaultTools(server: McpServer, rt: ToolRuntime): void {
  server.registerTool(
    'list-vault',
    {
      title: 'List Vault contents',
      description:
        'List a folder in the account\'s persistent /vault storage. Requires vault:read. Paths are ' +
        'relative to the vault root ("models/vae", not "/vault/models/vae"); omit path for the root. ' +
        '/vault survives instance restarts and deletion and is shared by every instance on the ' +
        'account, unlike /workspace which dies with its instance.',
      inputSchema: { path: z.string().optional().describe('Folder relative to the vault root') },
      annotations: READ_ONLY,
    },
    async ({ path }) =>
      guard(async () => {
        const d = await rt.client.request<Record<string, unknown>>(
          `/vault/list?path=${encodeURIComponent(path ?? '')}`
        );
        const files = (d['files'] as unknown[] | undefined) ?? [];
        return ok(
          { path: d['path'], totalBytes: d['totalBytes'], files: files.map(projectVaultEntry) },
          `${files.length} entr${files.length === 1 ? 'y' : 'ies'}.`
        );
      })
  );

  server.registerTool(
    'get-vault-stats',
    {
      title: 'Get Vault usage and quota',
      description:
        'Vault usage, quota and storage rate. Requires vault:read. Check this before a large upload: ' +
        'exceeding the quota fails the upload with 413.',
      annotations: READ_ONLY,
    },
    async () => guard(async () => ok(await rt.client.request('/vault/stats')))
  );

  server.registerTool(
    'upload-to-vault',
    {
      title: 'Upload a local file to Vault',
      description:
        'Upload a local file of any size into /vault using the resumable chunked protocol. Requires ' +
        'vault:write (the dashboard\'s "Upload token" preset is exactly this and nothing else - the ' +
        'right key for CI). Sends the bytes through the transfer host when available, which removes ' +
        'the 100 MB request cap. Handles sha256 verification, the server-chosen chunk size and ' +
        'resuming parts the server already holds. Runs to completion before returning, so prefer it ' +
        'for files up to a few GB; anything reachable by URL should use download-model-to-vault instead.',
      inputSchema: {
        localPath: z.string().describe('Absolute path to the file on this machine'),
        vaultPath: z
          .string()
          .describe('Destination relative to the vault root, including the filename'),
        parallel: z.number().int().min(1).max(8).optional().describe('Concurrent part uploads (default 4)'),
      },
      annotations: WRITE,
    },
    async ({ localPath, vaultPath, parallel }) =>
      guard(async () => {
        const info = await stat(localPath).catch(() => null);
        if (!info?.isFile()) return ok({}, `Not a readable file: ${localPath}. Nothing was uploaded.`);

        const sha256 = await sha256File(localPath);
        const base = await rt.client.resolveTransferBase();
        const session = await rt.client.request<Record<string, unknown>>('/vault/uploads', {
          method: 'POST',
          body: { path: vaultPath, size: info.size, sha256 },
          base,
        });
        const uploadId = String(session['uploadId']);
        // The session's chunkSize is authoritative - a part sized against anything else is rejected.
        const chunkSize = Number(session['chunkSize']);
        const partCount = Number(session['partCount']);

        const existing = await rt.client.request<Record<string, unknown>>(
          `/vault/uploads/${uploadId}`,
          { base }
        );
        const done = new Set<number>(((existing['receivedParts'] as number[]) ?? []).map(Number));

        const todo = Array.from({ length: partCount }, (_, n) => n).filter((n) => !done.has(n));
        const fh = await open(localPath, 'r');
        try {
          const limit = parallel ?? 4;
          for (let i = 0; i < todo.length; i += limit) {
            await Promise.all(
              todo.slice(i, i + limit).map(async (n) => {
                const len = Math.min(chunkSize, info.size - n * chunkSize);
                const buf = Buffer.alloc(len);
                await fh.read(buf, 0, len, n * chunkSize);
                await rt.client.request(`/vault/uploads/${uploadId}/parts/${n}`, {
                  method: 'PUT',
                  raw: buf,
                  base,
                  timeoutMs: 600_000,
                });
              })
            );
          }
        } finally {
          await fh.close();
        }

        await rt.client.request(`/vault/uploads/${uploadId}/complete`, { method: 'POST', base });
        for (;;) {
          const st = await rt.client.request<Record<string, unknown>>(
            `/vault/uploads/${uploadId}`,
            { base }
          );
          const status = String(st['status']);
          if (status === 'completed') {
            return ok(
              { uploadId, vaultPath, size: info.size, sha256, parts: partCount, via: base },
              `Uploaded ${info.size} bytes to ${vaultPath} (sha256 verified).`
            );
          }
          if (status === 'failed' || status === 'aborted') {
            return ok(st, `Upload ${status}: ${String(st['error'] ?? 'no reason given')}`);
          }
          await sleep(POLL_MS);
        }
      })
  );

  server.registerTool(
    'download-model-to-vault',
    {
      title: 'Download a URL or Hugging Face file into Vault',
      description:
        'Have the GPUtw server fetch a file straight into /vault - no running instance, no shell, no ' +
        'local copy, and the bytes never cross this machine. Requires vault:write. source accepts a ' +
        'direct https URL, a Hugging Face blob/resolve URL, or the shorthand ' +
        'hf:<owner>/<repo>:<file path>. For ComfyUI put models under models/<category>/ ' +
        '(checkpoints, diffusion_models, text_encoders, vae, loras, clip_vision, controlnet, ' +
        'upscale_models, embeddings) and they appear in its picker. Gated repos need hfToken, which ' +
        'is used for that one request and never stored. At most 3 downloads run at once per account.',
      inputSchema: {
        source: z.string().describe('https URL, HF blob/resolve URL, or hf:<owner>/<repo>:<path>'),
        targetPath: z
          .string()
          .describe('Destination relative to the vault root; a folder alone takes the name from the source'),
        hfToken: z.string().optional().describe('Hugging Face token for a gated repo; never stored'),
        wait: z
          .boolean()
          .optional()
          .describe('Wait for completion (default true). False returns the job id to poll yourself.'),
      },
      annotations: WRITE,
    },
    async ({ source, targetPath, hfToken, wait }) =>
      guard(async () => {
        const job = await rt.client.request<Record<string, unknown>>('/vault/downloads', {
          method: 'POST',
          body: { source, targetPath, ...(hfToken ? { hfToken } : {}) },
        });
        const id = String(job['id']);
        if (wait === false) {
          return ok({ id, status: job['status'], targetPath }, `Started download ${id}.`);
        }
        for (;;) {
          const d = await rt.client.request<Record<string, unknown>>(`/vault/downloads/${id}`);
          const status = String(d['status']);
          if (status === 'completed') {
            return ok(
              { id, targetPath: d['targetPath'], bytesDownloaded: d['bytesDownloaded'] },
              `Downloaded to ${String(d['targetPath'])}.`
            );
          }
          if (status === 'failed' || status === 'canceled') {
            return ok(
              d,
              `Download ${status}: ${String(d['error'] ?? 'no reason given')}. ` +
                'A gated Hugging Face repo needs hfToken.'
            );
          }
          await sleep(POLL_MS);
        }
      })
  );

  server.registerTool(
    'list-vault-downloads',
    {
      title: 'List recent Vault downloads',
      description:
        'Recent server-side download jobs with status and progress. Requires vault:read. Use it to ' +
        'check a job started with wait=false, or to see why one failed.',
      annotations: READ_ONLY,
    },
    async () => guard(async () => ok(await rt.client.request('/vault/downloads')))
  );
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      h.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await fh.close();
  }
  return h.digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
