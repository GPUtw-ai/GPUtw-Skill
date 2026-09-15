import { describe, expect, it } from 'vitest';
import { GputwClient } from '../src/client.js';
import { GputwApiError } from '../src/errors.js';
import { stubFetch } from './helpers.js';

const UA = 'gputw-mcp/test';

function makeClient(routes: Parameters<typeof stubFetch>[0], apiKey = 'gputw_live_k') {
  const { fetchImpl, calls } = stubFetch(routes);
  return { client: new GputwClient({ apiKey, userAgent: UA, fetchImpl }), calls };
}

describe('GputwClient', () => {
  it('sends a User-Agent and a bearer header, and unwraps the envelope', async () => {
    const { client, calls } = makeClient([{ match: '/instances', data: [{ id: 'i-1' }] }]);
    await expect(client.request('/instances')).resolves.toEqual([{ id: 'i-1' }]);
    expect(calls[0]!.headers['User-Agent']).toBe(UA);
    expect(calls[0]!.headers['Authorization']).toBe('Bearer gputw_live_k');
  });

  it('never puts the key in the query string', async () => {
    const { client, calls } = makeClient([{ match: '/instances', data: [] }]);
    await client.request('/instances');
    expect(calls[0]!.url).not.toContain('gputw_live_k');
  });

  it('omits the Authorization header on public endpoints', async () => {
    const { client, calls } = makeClient([{ match: '/gpus/active', data: [] }]);
    await client.request('/gpus/active', { auth: false });
    expect(calls[0]!.headers['Authorization']).toBeUndefined();
  });

  it('reaches public endpoints with no key configured', async () => {
    const { fetchImpl } = stubFetch([{ match: '/gpus/active', data: [{ id: 'g' }] }]);
    const client = new GputwClient({ userAgent: UA, fetchImpl });
    await expect(client.request('/gpus/active', { auth: false })).resolves.toEqual([{ id: 'g' }]);
  });

  it('fails fast with 401 when a key is required but absent', async () => {
    const { fetchImpl } = stubFetch([]);
    const client = new GputwClient({ userAgent: UA, fetchImpl });
    await expect(client.request('/instances')).rejects.toMatchObject({ status: 401 });
  });

  it('marks a non-envelope body as not enveloped', async () => {
    const { client } = makeClient([{ match: '/instances', status: 403, raw: '<html>1010</html>' }]);
    const err = await client.request('/instances').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GputwApiError);
    expect((err as GputwApiError).enveloped).toBe(false);
  });

  it('surfaces the envelope error string on a failure', async () => {
    const { client } = makeClient([
      { match: '/instances', status: 403, raw: JSON.stringify({ success: false, data: null, error: 'API key missing required scope: instances:read' }) },
    ]);
    const err = (await client.request('/instances').catch((e: unknown) => e)) as GputwApiError;
    expect(err.enveloped).toBe(true);
    expect(err.detail).toContain('instances:read');
  });

  it('treats success:false with HTTP 200 as an error', async () => {
    const { client } = makeClient([
      { match: '/instances', status: 200, raw: JSON.stringify({ success: false, data: null, error: 'nope' }) },
    ]);
    await expect(client.request('/instances')).rejects.toMatchObject({ status: 200, detail: 'nope' });
  });

  it('reports a network failure without leaking the key', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;
    const client = new GputwClient({ apiKey: 'gputw_live_SECRET', userAgent: UA, fetchImpl });
    const err = (await client.request('/instances').catch((e: unknown) => e)) as GputwApiError;
    expect(err.enveloped).toBe(false);
    expect(err.message).not.toContain('SECRET');
  });

  describe('resolveTransferBase', () => {
    it('uses the transfer host when /health answers', async () => {
      const { client } = makeClient([{ match: 'upload.gputw.ai/health', raw: 'ok' }]);
      await expect(client.resolveTransferBase()).resolves.toBe('https://upload.gputw.ai/api');
    });

    it('falls back to the API host when the transfer host is absent', async () => {
      const { client } = makeClient([{ match: 'upload.gputw.ai/health', status: 404, raw: 'nope' }]);
      await expect(client.resolveTransferBase()).resolves.toBe('https://api.gputw.ai/api');
    });

    it('falls back when the probe throws, and only probes once', async () => {
      let probes = 0;
      const fetchImpl = (async () => {
        probes += 1;
        throw new Error('dns');
      }) as unknown as typeof globalThis.fetch;
      const client = new GputwClient({ apiKey: 'k', userAgent: UA, fetchImpl });
      await expect(client.resolveTransferBase()).resolves.toBe('https://api.gputw.ai/api');
      await client.resolveTransferBase();
      expect(probes).toBe(1);
    });
  });
});
