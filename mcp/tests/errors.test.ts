import { describe, expect, it } from 'vitest';
import { GputwApiError, redactKeys } from '../src/errors.js';

describe('redactKeys', () => {
  it('removes API keys from arbitrary text', () => {
    expect(redactKeys('called with gputw_live_abc123DEF-x and done')).toBe(
      'called with gputw_live_[redacted] and done'
    );
  });
});

describe('GputwApiError.toAgentMessage', () => {
  it('blames the User-Agent when the body was not the envelope', () => {
    const msg = new GputwApiError(403, '<html>cloudflare error code: 1010</html>', false).toAgentMessage();
    expect(msg).toContain('never reached the API');
    expect(msg).toContain('User-Agent');
  });

  it('names the missing scope', () => {
    const msg = new GputwApiError(403, 'API key missing required scope: instances:create', true).toAgentMessage();
    expect(msg).toContain('`instances:create` scope');
    expect(msg).not.toContain('User-Agent');
  });

  it('sends browser-only routes to the dashboard', () => {
    const msg = new GputwApiError(403, 'This endpoint is not available to API keys. Use a browser session.', true).toAgentMessage();
    expect(msg).toContain('browser-session only');
  });

  it('explains the one-hour credit rule on 402', () => {
    const msg = new GputwApiError(402, 'Insufficient credits to cover one hour', true).toAgentMessage();
    expect(msg).toContain('one hour of EVERY running instance');
  });

  it('tells the caller to re-pick a machine on 409', () => {
    expect(new GputwApiError(409, 'This node already has an active instance', true).toAgentMessage()).toContain('taken by someone else');
  });

  it('does not leak a key that appears in the detail', () => {
    const msg = new GputwApiError(401, 'Invalid key gputw_live_SECRETVALUE', true).toAgentMessage();
    expect(msg).not.toContain('SECRETVALUE');
    expect(msg).toContain('gputw_live_[redacted]');
  });

  it('truncates a very long detail', () => {
    const msg = new GputwApiError(500, 'x'.repeat(1000), true).toAgentMessage();
    expect(msg).toContain('(truncated)');
    expect(msg.length).toBeLessThan(700);
  });
});

describe('non-envelope bodies', () => {
  it('describes an HTML body instead of dumping markup at the model', () => {
    const html = `<!DOCTYPE html><html><head>${'<script src="x"></script>'.repeat(40)}</head></html>`;
    const msg = new GputwApiError(404, html, false).toAgentMessage();
    expect(msg).toContain('HTML response body');
    expect(msg).not.toContain('<script');
    expect(msg).toContain('never reached the API');
    expect(msg.length).toBeLessThan(500);
  });

  it('still shows a short plain-text body verbatim', () => {
    expect(new GputwApiError(502, 'upstream connect error', false).toAgentMessage()).toContain('upstream connect error');
  });
});
