# Privacy

TokensFlow is local-only by design.

## Network

TokensFlow starts a server bound to `127.0.0.1`. It does not send usage data,
session logs, prompts, quotas, local history, or debug metadata to TokensFlow,
OpenAI, or any third-party service.

The browser polls local endpoints:

- `GET /api/usage`
- `GET /api/history`

## Files Read

For Codex mode, TokensFlow may read:

- `~/.codex/sessions/**/*.jsonl` for local Codex session events and the latest observed `rate_limits` event
- `~/.codex/state_5.sqlite` for local thread token metadata when available
- `~/.codex/goals_1.sqlite` for optional local goal metadata when available

For JSON fallback mode, TokensFlow reads:

- the packaged `data/usage.json`

JSON fallback mode is available for local development fixtures, but the shipped
CLI launches Codex mode by default.

## Files Written

When local history recording is enabled, TokensFlow writes JSONL history points to:

```text
~/.tokensflow/snapshots.jsonl
```

You can change or disable this with:

```bash
TOKENSFLOW_HISTORY=0
TOKENSFLOW_HISTORY_FILE=/path/to/snapshots.jsonl
```

The older `TOKENSFLOW_SNAPSHOT_*` names and `/api/snapshots` endpoint still work
as compatibility aliases.

The browser cannot choose an arbitrary history file path. The history endpoints
always read the server-configured history file.

## Telemetry

TokensFlow has no telemetry.

There is no analytics endpoint, no remote logging, no crash reporting, and no
tracking pixel.

## Limits

TokensFlow is not affiliated with OpenAI and does not use an official Codex
quota API. It reads local files that Codex has already written. If Codex has not
written a fresh `rate_limits` event yet, TokensFlow may lag behind the Codex UI.
