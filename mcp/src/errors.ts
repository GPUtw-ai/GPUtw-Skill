/**
 * Turning a GPUtw API failure into something an agent can act on.
 *
 * The API answers with a fixed envelope (`{ success, data, error }`), so a response that is
 * NOT that envelope means the request never reached GPUtw at all - typically Cloudflare
 * rejecting the client signature with 403 / `error code: 1010`. That distinction is the
 * single most useful thing to tell the caller, because a Cloudflare 403 looks exactly like
 * a permissions problem and is not one.
 */

/** Anything shaped like `gputw_live_…` never appears in text we hand back or log. */
export function redactKeys(text: string): string {
  return text.replace(/gputw_live_[A-Za-z0-9_-]+/g, 'gputw_live_[redacted]');
}

export class GputwApiError extends Error {
  constructor(
    readonly status: number,
    /** The `error` string from the envelope, or the raw body when there was no envelope. */
    readonly detail: string,
    /** False when the body was not the GPUtw envelope. */
    readonly enveloped: boolean
  ) {
    super(redactKeys(detail));
    this.name = 'GputwApiError';
  }

  /** The message handed to the model: what went wrong, then what to do about it. */
  toAgentMessage(): string {
    const hint = this.hint();
    const head = `GPUtw API error ${this.status}: ${this.summary()}`;
    return hint ? `${head}\n\nWhat to do: ${hint}` : head;
  }

  /**
   * A one-line summary of the body. An HTML body carries no information a model can use -
   * the status code and the hint already say everything - so it is described, not dumped.
   */
  private summary(): string {
    const detail = redactKeys(this.detail).trim();
    if (/^\s*<(!doctype|html|\?xml)/i.test(detail)) {
      return `(HTML response body, ${detail.length} bytes - not the GPUtw JSON envelope)`;
    }
    return truncate(detail, 400);
  }

  private hint(): string | undefined {
    if (!this.enveloped) {
      return (
        'the response was not the GPUtw envelope, so the request never reached the API. ' +
        'Check GPUTW_API_BASE (should be https://api.gputw.ai/api) and that a User-Agent header is ' +
        'being sent - Cloudflare rejects some client signatures with 403 / error code 1010.'
      );
    }
    const d = this.detail;
    if (this.status === 401) {
      return 'the API key is missing, invalid, expired or revoked. Create a new one in the GPUtw dashboard under API Keys and set GPUTW_API_KEY.';
    }
    if (this.status === 403) {
      const scope = /missing required scope: ([^\s"]+)/.exec(d);
      if (scope) {
        return `this key lacks the \`${scope[1]}\` scope. Update the key's scopes in the dashboard (API Keys) or issue a new key with it.`;
      }
      if (/not available to API keys/i.test(d)) {
        return 'this route is browser-session only and no scope unlocks it - do it in the GPUtw dashboard instead.';
      }
      if (/suspended by your organization/i.test(d)) {
        return 'the team owner has paused deployments for this member - ask the owner to lift it.';
      }
      if (/Account is disabled/i.test(d)) return 'the account is disabled - contact GPUtw support.';
      return 'the resource belongs to a different account, or the key cannot reach this route.';
    }
    if (this.status === 402) {
      return 'insufficient credits: deploying requires enough balance for one hour of EVERY running instance. Top up in the dashboard (the API cannot take payment).';
    }
    if (this.status === 404) {
      return 'the instance, file or template does not exist. If the host was upload.gputw.ai, note it only serves vault transfer routes - use https://api.gputw.ai/api for everything else.';
    }
    if (this.status === 409) {
      return 'state conflict - the machine was taken by someone else, or the upload session already closed. Re-read the current state and retry with fresh values.';
    }
    if (this.status === 413) return 'the file exceeds the Vault quota. Free space or request a larger quota.';
    if (this.status === 429) {
      return 'rate limited. Back off and retry after the RateLimit-Reset header; do not retry immediately.';
    }
    if (this.status === 503) return 'the selected machine is not schedulable - pick another from list-available-nodes.';
    if (this.status === 504) return 'the command exceeded its timeout. Raise timeoutMs (max 120000) or split the work.';
    if (this.status === 507) return 'Vault storage is temporarily full - retry later or contact support.';
    if (this.status >= 500) return 'server-side error. Retry with exponential backoff; if it persists, contact GPUtw support with the time of the request.';
    return undefined;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}… (truncated)`;
}
