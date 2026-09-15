import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connect, textOf } from './helpers.js';

/**
 * The chunked upload is the one tool with real bookkeeping - part offsets, the server-chosen
 * chunk size, and resume - so it gets a stub that behaves like the real protocol: it records
 * each part's bytes and reassembles them at the end.
 */
function uploadStub(opts: { chunkSize: number; alreadyHave?: number[] }) {
  const parts = new Map<number, Buffer>();
  const calls: string[] = [];
  let size = 0;
  let declaredSha = '';
  let completed = false;

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
    const envelope = (data: unknown, status = 200) =>
      new Response(JSON.stringify({ success: status < 400, data, error: null }), { status });

    if (url.endsWith('/health')) return new Response('ok');

    if (method === 'POST' && url.endsWith('/vault/uploads')) {
      const body = JSON.parse(String(init!.body)) as { size: number; sha256: string };
      size = body.size;
      declaredSha = body.sha256;
      return envelope({
        uploadId: 'up-1',
        chunkSize: opts.chunkSize,
        partCount: Math.ceil(size / opts.chunkSize),
        status: 'pending',
      });
    }
    const partMatch = /\/vault\/uploads\/up-1\/parts\/(\d+)$/.exec(url);
    if (method === 'PUT' && partMatch) {
      const n = Number(partMatch[1]);
      const buf = Buffer.from(init!.body as Uint8Array);
      const expected = Math.min(opts.chunkSize, size - n * opts.chunkSize);
      if (buf.length !== expected) {
        return envelope(null, 400); // mirrors "part N must be exactly X bytes"
      }
      parts.set(n, buf);
      return envelope({ part: n, size: buf.length });
    }
    if (method === 'POST' && url.endsWith('/vault/uploads/up-1/complete')) {
      completed = true;
      return envelope({ uploadId: 'up-1', status: 'assembling' }, 202);
    }
    if (method === 'GET' && url.endsWith('/vault/uploads/up-1')) {
      const received = [...(opts.alreadyHave ?? []), ...parts.keys()].sort((a, b) => a - b);
      if (!completed) return envelope({ uploadId: 'up-1', status: 'pending', receivedParts: received });
      // Reassemble in part order and check it against the declared digest.
      const all = Buffer.concat(received.map((n) => parts.get(n) ?? Buffer.alloc(0)));
      const sha = createHash('sha256').update(all).digest('hex');
      return envelope({
        uploadId: 'up-1',
        status: sha === declaredSha ? 'completed' : 'failed',
        error: sha === declaredSha ? null : 'sha256 mismatch',
        receivedParts: received,
      });
    }
    return envelope({ error: `unstubbed ${method} ${url}` }, 599);
  }) as unknown as typeof globalThis.fetch;

  return { fetchImpl, parts, calls };
}

async function tempFile(bytes: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gputw-mcp-'));
  const path = join(dir, 'model.bin');
  // Position-dependent content, so a wrong offset produces a digest mismatch.
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) buf[i] = i % 251;
  await writeFile(path, buf);
  return path;
}

describe('upload-to-vault', () => {
  it('splits at the server-chosen chunk size and reassembles to the right digest', async () => {
    const chunkSize = 1024;
    const path = await tempFile(chunkSize * 3 + 137); // 4 parts, last one short
    const { fetchImpl, parts } = uploadStub({ chunkSize });
    const { client } = await connect({ fetchImpl });

    const text = textOf(await client.callTool({
      name: 'upload-to-vault',
      arguments: { localPath: path, vaultPath: 'models/model.bin' },
    }));

    expect(text).toContain('sha256 verified');
    expect(parts.size).toBe(4);
    expect(parts.get(3)!.length).toBe(137);
    for (const n of [0, 1, 2]) expect(parts.get(n)!.length).toBe(chunkSize);
  });

  it('skips parts the server already holds', async () => {
    const chunkSize = 512;
    const path = await tempFile(chunkSize * 4);
    const { fetchImpl, parts, calls } = uploadStub({ chunkSize, alreadyHave: [0, 2] });
    const { client } = await connect({ fetchImpl });

    await client.callTool({ name: 'upload-to-vault', arguments: { localPath: path, vaultPath: 'm.bin' } });

    // Only the missing indices are PUT.
    expect([...parts.keys()].sort()).toEqual([1, 3]);
    expect(calls.filter((c) => c.startsWith('PUT'))).toHaveLength(2);
  });

  it('routes the bytes through the transfer host when it answers', async () => {
    const path = await tempFile(64);
    const { fetchImpl, calls } = uploadStub({ chunkSize: 64 });
    const { client } = await connect({ fetchImpl });
    await client.callTool({ name: 'upload-to-vault', arguments: { localPath: path, vaultPath: 'm.bin' } });
    expect(calls[0]).toBe('GET /health');
  });

  it('falls back to the API host when the transfer host is missing', async () => {
    const path = await tempFile(64);
    const inner = uploadStub({ chunkSize: 64 });
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/health')) return new Response('nope', { status: 404 });
      return inner.fetchImpl(input as never, init as never);
    }) as unknown as typeof globalThis.fetch;
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({
      name: 'upload-to-vault',
      arguments: { localPath: path, vaultPath: 'm.bin' },
    }));
    expect(text).toContain('api.gputw.ai');
  });

  it('handles a single-part file', async () => {
    const path = await tempFile(10);
    const { fetchImpl, parts } = uploadStub({ chunkSize: 1024 });
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({ name: 'upload-to-vault', arguments: { localPath: path, vaultPath: 'm.bin' } }));
    expect(text).toContain('sha256 verified');
    expect(parts.size).toBe(1);
    expect(parts.get(0)!.length).toBe(10);
  });

  it('reports a failed assembly with the server reason', async () => {
    const path = await tempFile(100);
    const inner = uploadStub({ chunkSize: 50 });
    // Corrupt one part in flight so the server-side digest check fails.
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (/parts\/1$/.test(url)) {
        const bad = Buffer.alloc((init!.body as Uint8Array).length, 0);
        return inner.fetchImpl(input as never, { ...init, body: bad } as never);
      }
      return inner.fetchImpl(input as never, init as never);
    }) as unknown as typeof globalThis.fetch;
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({ name: 'upload-to-vault', arguments: { localPath: path, vaultPath: 'm.bin' } }));
    expect(text).toContain('sha256 mismatch');
  });
});
