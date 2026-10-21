/**
 * Thin HTTP client for the GPUtw REST API.
 *
 * Everything the tools do goes through here so that three invariants hold in exactly one
 * place: a User-Agent is always sent, the response envelope is always unwrapped, and the
 * API key is never logged or echoed back.
 */
import { GputwApiError, redactKeys } from './errors.js';

export const DEFAULT_API_BASE = 'https://api.gputw.ai/api';
export const DEFAULT_TRANSFER_BASE = 'https://upload.gputw.ai';

/** Injected in tests; production passes nothing and gets global fetch. */
export type FetchLike = typeof globalThis.fetch;

export interface ClientOptions {
  apiKey?: string;
  apiBase?: string;
  transferBase?: string;
  userAgent: string;
  fetchImpl?: FetchLike;
  /** Longest one call may spend waiting out 429s before it gives up (default 5 minutes). */
  rateLimitMaxWaitMs?: number;
  /** Injected in tests so retries do not really wait. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Whether a 429 is a spent rate-limit window (worth waiting out) rather than a
 * standing refusal such as "3 vault downloads already running", which also answers
 * 429 but will not clear by waiting a few seconds. The API's limiter says its window
 * is spent with RateLimit-Remaining: 0; an edge limiter sends Retry-After only.
 */
export function isRetryable429(res: Pick<Response, 'status' | 'headers'>): boolean {
  if (res.status !== 429) return false;
  const remaining = res.headers.get('RateLimit-Remaining');
  if (remaining !== null) return remaining.trim() === '0';
  return res.headers.get('Retry-After') !== null;
}

/**
 * Milliseconds to wait after a 429: the server's RateLimit-Reset / Retry-After (seconds)
 * when present, else exponential backoff. Clamped to 1-60 s per attempt.
 */
export function retryAfterMs(res: Pick<Response, 'headers'>, attempt: number): number {
  for (const name of ['RateLimit-Reset', 'Retry-After']) {
    const v = Number(res.headers.get(name));
    if (res.headers.get(name) && Number.isFinite(v)) return Math.min(60_000, Math.max(1_000, v * 1000));
  }
  return Math.min(60_000, 1000 * 2 ** attempt);
}

interface RequestOptions {
  method?: string;
  /** JSON body. */
  body?: unknown;
  /** Raw body (chunked upload parts); sets application/octet-stream unless overridden. */
  raw?: Uint8Array;
  contentType?: string;
  /** Override the base URL, e.g. to hit the transfer host. */
  base?: string;
  /** Public endpoints (catalog, templates) work without a key. */
  auth?: boolean;
  timeoutMs?: number;
  /** Return the raw Response instead of unwrapping an envelope (file downloads). */
  rawResponse?: boolean;
}

export class GputwClient {
  readonly apiBase: string;
  private readonly apiKey?: string;
  private readonly transferBase: string;
  private readonly userAgent: string;
  private readonly fetchImpl: FetchLike;
  private readonly rateLimitMaxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Memoised transfer-host probe: null = not yet probed. */
  private transferResolved: string | null = null;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.apiBase = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    this.transferBase = (opts.transferBase ?? DEFAULT_TRANSFER_BASE).replace(/\/+$/, '');
    this.userAgent = opts.userAgent;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.rateLimitMaxWaitMs = opts.rateLimitMaxWaitMs ?? 300_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get hasKey(): boolean {
    return Boolean(this.apiKey);
  }

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, raw, base, auth = true, timeoutMs = 60_000 } = opts;
    if (auth && !this.apiKey) {
      throw new GputwApiError(401, 'GPUTW_API_KEY is not set for this server', true);
    }

    const headers: Record<string, string> = {
      // Required: without an explicit User-Agent, Cloudflare rejects some clients with 1010.
      'User-Agent': this.userAgent,
      Accept: 'application/json',
    };
    // The key only ever travels in this header - never in a query string.
    if (auth && this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    let payload: BodyInit | undefined;
    if (raw !== undefined) {
      payload = raw as unknown as BodyInit;
      headers['Content-Type'] = opts.contentType ?? 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const url = `${base ?? this.apiBase}${path}`;
    // A 429 is refused BEFORE the API does anything, so resending the same request -
    // even a create or a stop - cannot apply it twice. Wait out the window the server
    // names and retry, rather than failing an agent's step on a burst.
    let waited = 0;
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        res = await this.fetchImpl(url, { method, headers, body: payload, signal: ac.signal });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new GputwApiError(0, `network error contacting ${redactKeys(url)}: ${msg}`, false);
      } finally {
        clearTimeout(timer);
      }
      if (!isRetryable429(res)) break;
      const wait = retryAfterMs(res, attempt);
      if (waited + wait > this.rateLimitMaxWaitMs) break;
      waited += wait;
      await res.body?.cancel().catch(() => undefined);
      await this.sleep(wait);
    }

    if (opts.rawResponse) {
      if (!res.ok) throw new GputwApiError(res.status, await safeText(res), false);
      return res as unknown as T;
    }

    const text = await safeText(res);
    let env: { success?: boolean; data?: unknown; error?: string | null };
    try {
      env = JSON.parse(text) as typeof env;
    } catch {
      // Not the GPUtw envelope => the request never reached the API.
      throw new GputwApiError(res.status, text, false);
    }
    if (!res.ok || env.success !== true) {
      throw new GputwApiError(res.status, env.error ?? text, true);
    }
    return env.data as T;
  }

  /**
   * Base URL for bulk Vault transfers.
   *
   * The transfer host bypasses the 100 MB body cap and the ~100 s request timeout, but it
   * serves ONLY the vault upload/download routes. It may not exist on a given deployment, so
   * probe `/health` once and fall back to the API host rather than failing.
   */
  async resolveTransferBase(): Promise<string> {
    if (this.transferResolved) return this.transferResolved;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const res = await this.fetchImpl(`${this.transferBase}/health`, {
        headers: { 'User-Agent': this.userAgent },
        signal: ac.signal,
      });
      clearTimeout(timer);
      this.transferResolved = res.ok ? `${this.transferBase}/api` : this.apiBase;
    } catch {
      this.transferResolved = this.apiBase;
    }
    return this.transferResolved;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
