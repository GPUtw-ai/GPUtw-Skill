import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, type BuildOptions } from '../src/server.js';

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));
}

/** The `data` payload out of a captured envelope. */
export function fixtureData(name: string): unknown {
  return (fixture(name) as { data: unknown }).data;
}

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface StubRoute {
  /** Substring matched against the request URL. */
  match: string;
  method?: string;
  status?: number;
  /** Wrapped in the success envelope unless `raw` is set. */
  data?: unknown;
  /** Returned verbatim - use for non-envelope bodies (Cloudflare HTML) and error envelopes. */
  raw?: string;
}

export function stubFetch(routes: StubRoute[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const route = routes.find(
      (r) => url.includes(r.match) && (r.method === undefined || r.method === method)
    );
    if (!route) {
      return new Response(JSON.stringify({ success: false, data: null, error: `no stub for ${method} ${url}` }), { status: 599 });
    }
    const status = route.status ?? 200;
    const body = route.raw ?? JSON.stringify({ success: status < 400, data: route.data ?? null, error: null });
    return new Response(body, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

/** A connected in-memory client/server pair, so tests exercise real MCP plumbing. */
export async function connect(opts: BuildOptions = {}) {
  const server = buildServer({ apiKey: 'gputw_live_testkey0000', ...opts });
  const client = new Client({ name: 'test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

export function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content.map((c) => c.text ?? '').join('\n');
}

export function isError(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}
