# @gputw/mcp-server

Official [MCP](https://modelcontextprotocol.io) server for the **GPUtw** GPU cloud ([gputw.ai](https://gputw.ai)) — deploy and manage GPU instances, read live utilisation and logs, and move models into `/vault`, from any MCP client.

> **Beta** (`1.1.0-beta.1`). Ships as part of the [GPUtw Skill](https://github.com/GPUtw-ai/GPUtw-Skill), which also carries the integration guides the tools assume.

## Install

**Claude Code** — the plugin installs this server *and* the knowledge skill, and keeps the API key in secure storage:

```
/plugin marketplace add GPUtw-ai/GPUtw-Skill
/plugin install gputw@gputw
```

Or register the server on its own:

```bash
claude mcp add gputw -s user -e GPUTW_API_KEY=gputw_live_xxx -- npx -y @gputw/mcp-server@latest
```

**Any other client** (Claude Desktop, Cursor, VS Code, Windsurf, Codex, Gemini CLI):

```json
{
  "mcpServers": {
    "gputw": {
      "command": "npx",
      "args": ["-y", "@gputw/mcp-server@latest"],
      "env": { "GPUTW_API_KEY": "gputw_live_xxx" }
    }
  }
}
```

Get a key from the GPUtw dashboard → **API Keys**. Use the narrowest preset that fits: `readonly` to look, `deploy` to launch, `operator` to stop/restart, **Upload token** (write-only `vault:write`) for CI uploads.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `GPUTW_API_KEY` | — | Required for everything except the public catalogue |
| `GPUTW_API_BASE` | `https://api.gputw.ai/api` | Rarely changed |
| `GPUTW_TRANSFER_BASE` | `https://upload.gputw.ai` | Bulk-transfer host; falls back to the API host if absent |
| `GPUTW_MCP_ALLOW_EXEC` | unset | Set to `1` to expose `exec-in-instance` |

## Tools

**Catalogue** — `list-gpus`, `list-available-nodes`, `list-templates`, `get-deploy-options`
**Instances** — `create-instance`, `stop-instance`, `delete-instance`, `restart-instance`
**Live state** — `get-instance-status`, `get-instance-resources`, `get-instance-logs`, `get-instance-events`
**Vault** — `list-vault`, `get-vault-stats`, `upload-to-vault`, `download-model-to-vault`, `list-vault-downloads`
**Opt-in** — `exec-in-instance` (root shell; needs `GPUTW_MCP_ALLOW_EXEC=1` *and* the `instances:exec` scope)

Deploy order: `list-gpus` → `list-available-nodes` (with the `catalogId` from the first) → `list-templates` → `create-instance` (with the machine `id` as `nodeId`) → poll `get-instance-status` until `RUNNING`.

Not yet covered (use the REST API): ports and exposures, API-key management, billing, teams, notifications, reservations.

## Notes worth knowing

- **Instances bill while `RUNNING`.** Always finish with `stop-instance` or `delete-instance`.
- **Poll with `get-instance-status`,** not `list-instances` — it is the small, cheap read built for looping.
- **Read `usage.source` on `get-instance-resources` before trusting a number.** `none` means there is no telemetry and every metric is `null`; that is not the same as an idle GPU.
- **Responses are projected.** A catalogue record carries ~50 fields; the tools return the decision-relevant subset so the model's context is not spent on marketing copy.
- **Errors are translated into actions** — which scope is missing, that credit is short, that a machine was taken, or that a non-envelope response means the request never reached the API (usually a missing `User-Agent`).
- **`delete-instance` destroys `/workspace`.** `/vault` is untouched.

## Security

The server acts with the full permissions of the key it is given.

- The key is read from the environment, never written to disk by this server, and never logged. Anything matching `gputw_live_…` is redacted from returned text.
- `exec-in-instance` is not registered unless you opt in. It is a root shell in your container, needs a scope only the `full` preset grants, and every call is written to your account audit trail.
- In stdio mode the key stays on your machine; no third party is involved.

## Develop

```bash
npm install
npm run type-check
npm test        # 55 offline tests - no network, no API key
npm run build
node dist/stdio.mjs --help
```

`dist/stdio.mjs` is a single bundled file and is **committed** to the repository, so the Claude Code plugin runs it with plain `node` straight from a clone. CI rebuilds it and fails if the committed copy is stale.

## License

MIT — see [LICENSE](../LICENSE).
