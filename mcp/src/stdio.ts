import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer, VERSION } from './server.js';

function truthy(v: string | undefined): boolean {
  return v === '1' || v?.toLowerCase() === 'true';
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      [
        `GPUtw MCP server ${VERSION}`,
        '',
        'An MCP stdio server for the GPUtw GPU cloud. Configure it in your MCP client rather',
        'than running it by hand; it speaks JSON-RPC on stdin/stdout.',
        '',
        'Environment:',
        '  GPUTW_API_KEY        required for everything except the public catalogue',
        '  GPUTW_API_BASE       default https://api.gputw.ai/api',
        '  GPUTW_TRANSFER_BASE  default https://upload.gputw.ai',
        '  GPUTW_MCP_ALLOW_EXEC set to 1 to expose exec-in-instance (root shell, audited)',
        '',
        'Claude Code:',
        '  claude mcp add gputw -s user -e GPUTW_API_KEY=gputw_live_… -- npx -y @gputw/mcp-server@latest',
        '',
      ].join('\n')
    );
    return;
  }

  const server = buildServer({
    apiKey: process.env['GPUTW_API_KEY'],
    apiBase: process.env['GPUTW_API_BASE'],
    transferBase: process.env['GPUTW_TRANSFER_BASE'],
    allowExec: truthy(process.env['GPUTW_MCP_ALLOW_EXEC']),
  });

  // stdout is the JSON-RPC channel: diagnostics must go to stderr or they corrupt the stream.
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`gputw-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
