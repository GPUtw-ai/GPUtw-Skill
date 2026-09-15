/**
 * Shared plumbing for tool registrars: the client handle, annotation presets and the
 * result helpers that shape every tool's reply.
 */
import type { GputwClient } from '../client.js';
import { GputwApiError } from '../errors.js';

export interface ToolRuntime {
  client: GputwClient;
  /** exec-in-instance is only registered when the operator opted in. */
  allowExec: boolean;
}

/**
 * Tool annotations are hints, but clients use them to group tools and to decide what needs
 * confirmation - so a delete must not look like a read. `openWorldHint` is true throughout:
 * every tool talks to the external GPUtw API.
 */
export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
export const WRITE = { readOnlyHint: false, openWorldHint: true } as const;
export const IDEMPOTENT_WRITE = { ...WRITE, idempotentHint: true } as const;
export const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export function ok(payload: unknown, note?: string): ToolResult {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text: note ? `${note}\n\n${body}` : body }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Every handler runs inside this so a failed API call comes back as a readable, actionable
 * tool error rather than an unhandled rejection that the client renders as a stack trace.
 */
export async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GputwApiError) return fail(err.toAgentMessage());
    return fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
