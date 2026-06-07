# TokensFlow

A tiny open-source local app for watching the latest observed Codex quota snapshot, reset time, and local session token meter.

TokensFlow is intentionally small: plain HTML, CSS, browser JavaScript, and a Node server with no runtime dependencies. The default source is `auto`: it reads local Codex session data when available, then falls back to `data/usage.json`. The app polls `/api/usage` every two seconds.

## Important Disclaimer

TokensFlow is not affiliated with OpenAI.

There is no official public Codex quota API used by this tool. TokensFlow reads local Codex session logs and shows the latest observed `rate_limits` event written by Codex. It may lag behind the Codex UI if Codex has not written a new `rate_limits` event yet.

TokensFlow should be treated as a lightweight local monitor, not as an official billing, quota, or entitlement source.

## Run

Published package workflow:

```bash
npx aleksip
```

The CLI asks which provider you want to watch:

- Codex
- Claude Code
- Cursor

Scriptable examples:

```bash
npx aleksip --tool codex
npx aleksip --tool claude
npx aleksip --tool cursor
```

You can still pass a project path if you want, but it is optional. Without a path, TokensFlow uses the current terminal folder.

Local development:

```bash
npm start
```

`npm start` launches the local app and opens TokensFlow. During development, use:

```bash
npm run dev
```

TokensFlow is also a PWA. From a supported browser, install it as a standalone app from the browser install menu.

## Automatic Local Snapshots

When TokensFlow is running, it automatically records the latest observed Codex quota snapshot every 5 minutes. There is no extra setup and no macOS automation to install.

Snapshots are written as JSONL:

```text
~/.tokensflow/snapshots.jsonl
```

This records what Codex has already written locally. It does not force Codex to create a new `rate_limits` event.

Useful controls:

```bash
TOKENSFLOW_SNAPSHOTS=0                  # disable snapshot recording
TOKENSFLOW_SNAPSHOT_INTERVAL_MS=300000  # default: 5 minutes
TOKENSFLOW_SNAPSHOT_FILE=...            # custom JSONL output path
```

## Codex Snapshot Mode

By default, TokensFlow reads:

- `~/.codex/sessions/**/*.jsonl` for the latest observed Codex `rate_limits` snapshot
- `~/.codex/state_5.sqlite` for local thread/session token usage
- `~/.codex/goals_1.sqlite` for optional local goal metadata

The Codex quota cards only use Codex `rate_limits`. The local token meter is displayed separately as a local session meter and is never used to calculate Codex quota percentage.

## Last 24h Codex Activity

The activity chart scans local Codex JSONL session logs under:

```text
~/.codex/sessions/**/*.jsonl
```

It includes events from the last 24 hours across all local Codex sessions, not only the current project. Buckets are computed in the `Europe/Paris` timezone. TokensFlow prefers parsed token usage from `last_token_usage` / token usage fields when available; otherwise it falls back to counting session events.

The UI exposes debug metadata for transparency:

- window: last 24h
- timezone
- files scanned
- sessions parsed
- events parsed
- active hours
- latest event time
- activity metric
- latest `rate_limits` file
- hourly buckets

Useful environment variables:

```bash
TOKENSFLOW_SOURCE=auto              # auto, codex, or json
TOKENSFLOW_TOOL=codex               # codex, claude, cursor, or json
TOKENSFLOW_BUDGET_TOKENS=2000000    # fallback budget when no goal budget exists
TOKENSFLOW_WEEKLY_BUDGET_TOKENS=10000000
TOKENSFLOW_CWD="$PWD"               # project whose latest Codex thread should be watched
TOKENSFLOW_THREAD_ID=...            # optional exact Codex thread id
TOKENSFLOW_CODEX_STATE_DB=...       # optional custom state_5.sqlite path
TOKENSFLOW_CODEX_GOALS_DB=...       # optional custom goals_1.sqlite path
TOKENSFLOW_CODEX_SESSIONS_ROOT=...  # optional custom Codex sessions path
TOKENSFLOW_CLAUDE_USAGE_FILE=...    # optional JSON usage source for Claude Code
TOKENSFLOW_CURSOR_USAGE_FILE=...    # optional JSON usage source for Cursor
```

Example:

```bash
TOKENSFLOW_SOURCE=codex \
TOKENSFLOW_BUDGET_TOKENS=2000000 \
npm run dev
```

## How Accurate Is It?

TokensFlow is accurate to the latest local Codex `rate_limits` event it can read.

It is not guaranteed to match the Codex UI second-by-second. If Codex has newer quota state in memory but has not written a new session-log event yet, TokensFlow will show the latest older snapshot and mark the source as `recent`, `idle`, or `old`.

Freshness states:

- `recent`: source observed less than 2 minutes ago
- `idle`: source observed 2-29 minutes ago
- `old`: source observed 30 minutes ago or more
- `offline`: no Codex `rate_limits` event was found

Best use: a beautiful, lightweight local monitor that makes quota snapshots easier to see without opening settings.

## Provider Status

Codex is automatic today because Codex stores local session logs and local thread token usage on disk.

Claude Code and Cursor can be selected from the CLI now. If TokensFlow cannot find a local machine-readable quota source, it shows a clear `not connected` state and still supports a JSON usage file via:

```bash
TOKENSFLOW_CLAUDE_USAGE_FILE=~/.tokensflow/claude-usage.json npx aleksip --tool claude
TOKENSFLOW_CURSOR_USAGE_FILE=~/.tokensflow/cursor-usage.json npx aleksip --tool cursor
```

## Update Live Data

Edit `data/usage.json`, or post a replacement payload. Posted data is saved to the JSON fallback source:

```bash
curl -X POST http://127.0.0.1:3000/api/usage \
  -H "Content-Type: application/json" \
  -d '{"source":"local","budgetTokens":1000000,"usedTokens":420000,"burnRatePerHour":15000}'
```

The expected payload is deliberately simple:

```json
{
  "source": "demo-json",
  "budgetTokens": 1000000,
  "usedTokens": 318400,
  "inputTokens": 217900,
  "outputTokens": 100500,
  "retailCostUsd": 42.18,
  "burnRatePerHour": 14800,
  "quotaResetAt": "2026-06-07T20:00:00+02:00",
  "weeklyBudgetTokens": 5000000,
  "weeklyUsedTokens": 1120000,
  "weeklyResetAt": "2026-06-08T00:00:00+02:00",
  "sessions": 9,
  "agentsAverage": 2.2,
  "resetAt": "2026-06-07T00:00:00+02:00",
  "history": [
    { "label": "00", "usedTokens": 16000 }
  ]
}
```

## Test

```bash
npm test
npm run check
```

## Roadmap

- Add adapters for Claude, OpenAI API billing, and local usage logs.
- Add a tray or always-on-top desktop wrapper.
- Add import/export presets for community dashboards.

## License

MIT
