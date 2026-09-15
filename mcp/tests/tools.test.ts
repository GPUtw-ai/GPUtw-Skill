import { describe, expect, it } from 'vitest';
import { connect, fixtureData, isError, stubFetch, textOf } from './helpers.js';

const gpus = fixtureData('gpus_active') as Record<string, unknown>[];
const templates = fixtureData('templates') as Record<string, unknown>[];

describe('tool registration', () => {
  it('exposes the documented surface and hides exec by default', async () => {
    const { fetchImpl } = stubFetch([]);
    const { client } = await connect({ fetchImpl });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'create-instance', 'delete-instance', 'download-model-to-vault', 'get-deploy-options',
        'get-instance-events', 'get-instance-logs', 'get-instance-resources', 'get-instance-status',
        'get-vault-stats', 'list-available-nodes', 'list-gpus', 'list-instances',
        'list-templates', 'list-vault', 'list-vault-downloads', 'restart-instance',
        'stop-instance', 'upload-to-vault',
      ].sort()
    );
    expect(names).not.toContain('exec-in-instance');
  });

  it('registers exec only when explicitly allowed', async () => {
    const { fetchImpl } = stubFetch([]);
    const { client } = await connect({ fetchImpl, allowExec: true });
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('exec-in-instance');
  });

  it('annotates reads, writes and deletes distinctly', async () => {
    const { fetchImpl } = stubFetch([]);
    const { client } = await connect({ fetchImpl });
    const byName = new Map((await client.listTools()).tools.map((t) => [t.name, t.annotations]));
    expect(byName.get('list-gpus')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('create-instance')).toMatchObject({ readOnlyHint: false });
    expect(byName.get('delete-instance')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.get('stop-instance')).toMatchObject({ idempotentHint: true });
  });

  it('gives every tool a description, so a client can route without guessing', async () => {
    const { fetchImpl } = stubFetch([]);
    const { client } = await connect({ fetchImpl, allowExec: true });
    for (const t of (await client.listTools()).tools) {
      expect(t.description, `${t.name} has no description`).toBeTruthy();
      expect(t.description!.length, `${t.name} description too short`).toBeGreaterThan(80);
    }
  });
});

describe('catalogue tools', () => {
  it('projects the GPU catalogue instead of dumping every field', async () => {
    const { fetchImpl } = stubFetch([{ match: '/gpus/active', data: gpus }]);
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({ name: 'list-gpus', arguments: {} }));
    const parsed = JSON.parse(text.slice(text.indexOf('['))) as Record<string, unknown>[];

    expect(parsed).toHaveLength(gpus.length);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('vramGb');
    // The live record carries ~50 fields; the projection must be far smaller.
    expect(Object.keys(gpus[0]!).length).toBeGreaterThan(30);
    expect(Object.keys(parsed[0]!).length).toBeLessThan(20);
    // Marketing prose must not reach the model.
    expect(parsed[0]).not.toHaveProperty('description');
    expect(parsed[0]).not.toHaveProperty('descriptionZh');
    expect(parsed[0]).not.toHaveProperty('heroImageUrl');
  });

  it('reads the catalogue with no API key at all', async () => {
    const { fetchImpl, calls } = stubFetch([{ match: '/gpus/active', data: gpus }]);
    const { client } = await connect({ fetchImpl, apiKey: undefined });
    expect(isError(await client.callTool({ name: 'list-gpus', arguments: {} }))).toBe(false);
    expect(calls[0]!.headers['Authorization']).toBeUndefined();
  });

  it('explains an empty machine list rather than returning a bare []', async () => {
    const { fetchImpl } = stubFetch([{ match: '/nodes/available', data: [] }]);
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({ name: 'list-available-nodes', arguments: { catalogId: 'c1' } }));
    expect(text).toContain('No machines are free');
  });

  it('passes catalogId through url-encoded', async () => {
    const { fetchImpl, calls } = stubFetch([{ match: '/nodes/available', data: [] }]);
    const { client } = await connect({ fetchImpl });
    await client.callTool({ name: 'list-available-nodes', arguments: { catalogId: 'a b/c' } });
    expect(calls[0]!.url).toContain('catalogId=a%20b%2Fc');
  });

  it('filters templates by name and architecture', async () => {
    const { fetchImpl } = stubFetch([{ match: '/templates', data: templates }]);
    const { client } = await connect({ fetchImpl });

    const pytorch = textOf(await client.callTool({ name: 'list-templates', arguments: { search: 'pytorch' } }));
    expect(pytorch).toContain('PyTorch');
    expect(pytorch).not.toContain('ComfyUI');

    const arm = textOf(await client.callTool({ name: 'list-templates', arguments: { arch: 'arm64' } }));
    const armParsed = JSON.parse(arm.slice(arm.indexOf('['))) as Record<string, unknown>[];
    expect(armParsed.length).toBeGreaterThan(0);
    for (const t of armParsed) expect(t['architectures']).toContain('arm64');
  });
});

describe('instance tools', () => {
  it('flags how many instances are billing', async () => {
    const { fetchImpl } = stubFetch([
      { match: '/instances', data: [{ id: 'a', status: 'RUNNING' }, { id: 'b', status: 'STOPPED' }] },
    ]);
    const { client } = await connect({ fetchImpl });
    expect(textOf(await client.callTool({ name: 'list-instances', arguments: {} }))).toContain('1 RUNNING');
  });

  it('warns when telemetry is absent instead of implying idle', async () => {
    const { fetchImpl } = stubFetch([
      { match: '/resources', data: { instanceId: 'i', status: 'RUNNING', allocated: {}, usage: { gpuPct: null, source: 'none' }, billing: {} } },
    ]);
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({ name: 'get-instance-resources', arguments: { instanceId: 'i' } }));
    expect(text).toContain('NOT the same as idle');
  });

  it('stays quiet about telemetry when the source is live', async () => {
    const { fetchImpl } = stubFetch([
      { match: '/resources', data: { instanceId: 'i', usage: { gpuPct: 97, source: 'prometheus' } } },
    ]);
    const { client } = await connect({ fetchImpl });
    expect(textOf(await client.callTool({ name: 'get-instance-resources', arguments: { instanceId: 'i' } }))).not.toContain('NOT the same as idle');
  });

  it('requests the previous container when asked', async () => {
    const { fetchImpl, calls } = stubFetch([{ match: '/logs', data: { log: 'boom', podExists: true } }]);
    const { client } = await connect({ fetchImpl });
    await client.callTool({ name: 'get-instance-logs', arguments: { instanceId: 'i', tail: 50, previous: true } });
    expect(calls[0]!.url).toContain('tail=50');
    expect(calls[0]!.url).toContain('previous=1');
  });

  it('refuses a create with two image sources and never calls the API', async () => {
    const { fetchImpl, calls } = stubFetch([{ match: '/instances/create', data: {} }]);
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({
      name: 'create-instance',
      arguments: { nodeId: 'n1', templateId: 't1', template: 'gputw/pytorch:latest' },
    }));
    expect(text).toContain('exactly one of');
    expect(calls).toHaveLength(0);
  });

  it('refuses a create with no image source', async () => {
    const { fetchImpl, calls } = stubFetch([{ match: '/instances/create', data: {} }]);
    const { client } = await connect({ fetchImpl });
    expect(textOf(await client.callTool({ name: 'create-instance', arguments: { nodeId: 'n1' } }))).toContain('exactly one of');
    expect(calls).toHaveLength(0);
  });

  it('creates an instance and reminds the caller about billing', async () => {
    const { fetchImpl, calls } = stubFetch([
      { match: '/instances/create', method: 'POST', data: { id: 'i-9', status: 'DEPLOYING', hourlyRate: 0.28 } },
    ]);
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({
      name: 'create-instance',
      arguments: { nodeId: 'n1', templateId: 't1', ports: [8080] },
    }));
    expect(text).toContain('i-9');
    expect(text).toContain('stop or delete');
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ nodeId: 'n1', templateId: 't1', ports: [8080] });
  });

  it('maps a scope failure on create into actionable text', async () => {
    const { fetchImpl } = stubFetch([
      { match: '/instances/create', method: 'POST', status: 403, raw: JSON.stringify({ success: false, data: null, error: 'API key missing required scope: instances:create' }) },
    ]);
    const { client } = await connect({ fetchImpl });
    const res = await client.callTool({ name: 'create-instance', arguments: { nodeId: 'n', templateId: 't' } });
    expect(isError(res)).toBe(true);
    expect(textOf(res)).toContain('`instances:create` scope');
  });

  it('maps insufficient credit into a top-up instruction', async () => {
    const { fetchImpl } = stubFetch([
      { match: '/instances/create', method: 'POST', status: 402, raw: JSON.stringify({ success: false, data: null, error: 'Insufficient credits to cover one hour of your total running instances' }) },
    ]);
    const { client } = await connect({ fetchImpl });
    expect(textOf(await client.callTool({ name: 'create-instance', arguments: { nodeId: 'n', templateId: 't' } }))).toContain('Top up in the dashboard');
  });

  it('requires a nodeId for an alternative restart', async () => {
    const { fetchImpl, calls } = stubFetch([{ match: '/restart', data: {} }]);
    const { client } = await connect({ fetchImpl });
    expect(textOf(await client.callTool({ name: 'restart-instance', arguments: { instanceId: 'i', mode: 'alternative' } }))).toContain('requires a nodeId');
    expect(calls).toHaveLength(0);
  });

  it('sends exec argv verbatim', async () => {
    const { fetchImpl, calls } = stubFetch([
      { match: '/exec', method: 'POST', data: { stdout: 'ok', stderr: '', exitCode: 0, truncated: false } },
    ]);
    const { client } = await connect({ fetchImpl, allowExec: true });
    await client.callTool({ name: 'exec-in-instance', arguments: { instanceId: 'i', command: ['sh', '-c', 'ls | wc -l'] } });
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ command: ['sh', '-c', 'ls | wc -l'] });
  });

  it('reports exec truncation', async () => {
    const { fetchImpl } = stubFetch([
      { match: '/exec', method: 'POST', data: { stdout: 'x', stderr: '', exitCode: 0, truncated: true } },
    ]);
    const { client } = await connect({ fetchImpl, allowExec: true });
    expect(textOf(await client.callTool({ name: 'exec-in-instance', arguments: { instanceId: 'i', command: ['ls'] } }))).toContain('truncated');
  });
});

describe('vault tools', () => {
  it('projects vault listings and counts them', async () => {
    const { fetchImpl } = stubFetch([
      { match: '/vault/list', data: { path: 'models', totalBytes: 10, files: [{ name: 'a.safetensors', size: 10, modifiedAt: 't', type: 'file', internalId: 'leak' }] } },
    ]);
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({ name: 'list-vault', arguments: { path: 'models' } }));
    expect(text).toContain('1 entry');
    expect(text).toContain('a.safetensors');
    expect(text).not.toContain('internalId');
  });

  it('polls a server-side download to completion', async () => {
    const { fetchImpl, calls } = stubFetch([
      { match: '/vault/downloads', method: 'POST', data: { id: 'd1', status: 'pending' } },
      { match: '/vault/downloads/d1', method: 'GET', data: { id: 'd1', status: 'completed', targetPath: 'models/vae/x.safetensors', bytesDownloaded: 99 } },
    ]);
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({
      name: 'download-model-to-vault',
      arguments: { source: 'hf:o/r:f.safetensors', targetPath: 'models/vae' },
    }));
    expect(text).toContain('Downloaded to models/vae/x.safetensors');
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ source: 'hf:o/r:f.safetensors', targetPath: 'models/vae' });
  });

  it('omits hfToken from the request body when not supplied', async () => {
    const { fetchImpl, calls } = stubFetch([
      { match: '/vault/downloads', method: 'POST', data: { id: 'd1' } },
      { match: '/vault/downloads/d1', data: { status: 'completed', targetPath: 'p' } },
    ]);
    const { client } = await connect({ fetchImpl });
    await client.callTool({ name: 'download-model-to-vault', arguments: { source: 'https://x/y', targetPath: 'p' } });
    expect(JSON.parse(calls[0]!.body!)).not.toHaveProperty('hfToken');
  });

  it('returns the job id without waiting when wait is false', async () => {
    const { fetchImpl, calls } = stubFetch([{ match: '/vault/downloads', method: 'POST', data: { id: 'd2', status: 'pending' } }]);
    const { client } = await connect({ fetchImpl });
    expect(textOf(await client.callTool({
      name: 'download-model-to-vault',
      arguments: { source: 'https://x/y', targetPath: 'p', wait: false },
    }))).toContain('Started download d2');
    expect(calls).toHaveLength(1);
  });

  it('surfaces a gated-repo failure with the token hint', async () => {
    const { fetchImpl } = stubFetch([
      { match: '/vault/downloads', method: 'POST', data: { id: 'd3' } },
      { match: '/vault/downloads/d3', data: { status: 'failed', error: 'gated repo' } },
    ]);
    const { client } = await connect({ fetchImpl });
    const text = textOf(await client.callTool({ name: 'download-model-to-vault', arguments: { source: 'hf:a/b:c', targetPath: 'p' } }));
    expect(text).toContain('failed');
    expect(text).toContain('hfToken');
  });

  it('refuses to upload a path that is not a file', async () => {
    const { fetchImpl, calls } = stubFetch([]);
    const { client } = await connect({ fetchImpl });
    expect(textOf(await client.callTool({
      name: 'upload-to-vault',
      arguments: { localPath: '/definitely/not/here.bin', vaultPath: 'x.bin' },
    }))).toContain('Not a readable file');
    expect(calls).toHaveLength(0);
  });
});
