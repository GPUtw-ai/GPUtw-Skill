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
  /** Memoised transfer-host probe: null = not yet probed. */
  private transferResolved: string | null = null;

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey;
    this.apiBase = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    this.transferBase = (opts.transferBase ?? DEFAULT_TRANSFER_BASE).replace(/\/+$/, '');
    this.userAgent = opts.userAgent;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
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
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, body: payload, signal: ac.signal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new GputwApiError(0, `network error contacting ${redactKeys(url)}: ${msg}`, false);
    } finally {
      clearTimeout(timer);
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
