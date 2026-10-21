import { describe, expect, it } from 'vitest';
import { GputwClient, isRetryable429, retryAfterMs } from '../src/client.js';
import { GputwApiError } from '../src/errors.js';

const UA = 'gputw-mcp/test';

/** Answers 429 `refusals` times (RateLimit-Reset: 7), then the envelope. */
function flaky(refusals: number) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls <= refusals) {
      return new Response(JSON.stringify({ success: false, data: null, error: 'Too many', code: 'RATE_LIMITED' }), {
        status: 429,
        headers: { 'RateLimit-Reset': '7', 'RateLimit-Remaining': '0' },
      });
    }
    return new Response(JSON.stringify({ success: true, data: { id: 'i-1' } }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetchImpl, count: () => calls };
}

describe('429 handling', () => {
  it('waits out the server-named window and retries, so a burst does not fail the call', async () => {
    const waits: number[] = [];
    const f = flaky(2);
    const client = new GputwClient({ apiKey: 'k', userAgent: UA, fetchImpl: f.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
    await expect(client.request('/instances/delete', { method: 'POST', body: { instanceId: 'x' } })).resolves.toEqual({ id: 'i-1' });
    expect(f.count()).toBe(3);
    expect(waits).toEqual([7000, 7000]);
  });

  it('gives up with the 429 once the wait budget is spent', async () => {
    const f = flaky(100);
    const client = new GputwClient({ apiKey: 'k', userAgent: UA, fetchImpl: f.fetchImpl, rateLimitMaxWaitMs: 10_000, sleep: async () => {} });
    const err = await client.request('/x').catch((e) => e);
    expect(err).toBeInstanceOf(GputwApiError);
    expect((err as GputwApiError).status).toBe(429);
  });

  it('does not wait on a 429 that is not a spent window (vault download concurrency cap)', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ success: false, data: null, error: 'At most 3 concurrent downloads' }), {
        status: 429,
        headers: { 'RateLimit-Remaining': '2950', 'RateLimit-Reset': '120' },
      });
    }) as typeof globalThis.fetch;
    const client = new GputwClient({ apiKey: 'k', userAgent: UA, fetchImpl, sleep: async () => { throw new Error('must not wait'); } });
    const err = await client.request('/vault/downloads', { method: 'POST', body: {} }).catch((e) => e);
    expect((err as GputwApiError).status).toBe(429);
    expect(calls).toBe(1);
  });

  it('waits on an edge 429 that only carries Retry-After', () => {
    expect(isRetryable429({ status: 429, headers: new Headers({ 'Retry-After': '5' }) })).toBe(true);
    expect(isRetryable429({ status: 429, headers: new Headers() })).toBe(false);
  });

  it('falls back to exponential backoff, clamped to 1-60 s', () => {
    const none = { headers: new Headers() };
    expect(retryAfterMs(none, 0)).toBe(1000);
    expect(retryAfterMs(none, 3)).toBe(8000);
    expect(retryAfterMs(none, 10)).toBe(60_000);
    expect(retryAfterMs({ headers: new Headers({ 'Retry-After': '0' }) }, 0)).toBe(1000);
  });
});
