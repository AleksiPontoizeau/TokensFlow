# Privacy

TokensFlow is local-only by design.

## Network

TokensFlow starts a server bound to `127.0.0.1`. It does not send usage data,
session logs, prompts, quotas, snapshots, or debug metadata to TokensFlow,
OpenAI, or any third-party service.

The browser polls local endpoints:

- `GET /api/usage`
- `GET /api/snapshots`

## Files Read

For Codex mode, TokensFlow may read:

- `~/.codex/sessions/**/*.jsonl` for local Codex session events and the latest observed `rate_limits` event
- `~/.codex/state_5.sqlite` for local thread token metadata when available
- `~/.codex/goals_1.sqlite` for optional local goal metadata when available

For JSON fallback mode, TokensFlow reads:

- the packaged `data/usage.json`

For Claude Code and Cursor placeholder modes, TokensFlow only reads a JSON file
when you explicitly provide one with:

- `TOKENSFLOW_CLAUDE_USAGE_FILE`
- `TOKENSFLOW_CURSOR_USAGE_FILE`

## Files Written

When snapshot recording is enabled, TokensFlow writes local JSONL snapshots to:

```text
~/.tokensflow/snapshots.jsonl
```

You can change or disable this with:

```bash
TOKENSFLOW_SNAPSHOTS=0
TOKENSFLOW_SNAPSHOT_FILE=/path/to/snapshots.jsonl
```

The browser cannot choose an arbitrary snapshot file path. `/api/snapshots`
always reads the server-configured snapshot file.

## Telemetry

TokensFlow has no telemetry.

There is no analytics endpoint, no remote logging, no crash reporting, and no
tracking pixel.

## Limits

TokensFlow is not affiliated with OpenAI and does not use an official Codex
quota API. It reads local files that Codex has already written. If Codex has not
written a fresh `rate_limits` event yet, TokensFlow may lag behind the Codex UI.
