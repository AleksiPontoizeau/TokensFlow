# TokensFlow

A tiny open-source local companion for watching the latest observed Codex quota file, reset time, local session activity, and local history.

TokensFlow is intentionally small: plain HTML, CSS, browser JavaScript, and a Node server. The main experience is Codex-first: it reads the local Codex `rate_limits` events, shows the latest observed quota file, and records a small local history every 5 minutes so you can see quota movement over time.

## Important Disclaimer

TokensFlow is not affiliated with OpenAI.

There is no official public Codex quota API used by this tool. TokensFlow reads local Codex session logs and shows the latest observed `rate_limits` event written by Codex. That is the same local quota signal exposed in Codex session files, not a TokensFlow estimate. It may lag behind the Codex UI if Codex has not written a new `rate_limits` event yet.

TokensFlow should be treated as a lightweight local monitor, not as an official billing, quota, or entitlement source.

## Run

Published package workflow:

```bash
npx tokensflow
```

TokensFlow launches directly in Codex mode:

```bash
npx tokensflow --tool codex
```

You can still pass a project path if you want, but it is optional. Without a path, TokensFlow uses the current terminal folder.

Menu bar mode for macOS:

```bash
npx tokensflow --tray
```

This starts a detached local worker that shows the latest observed 5h Codex quota remaining in the macOS menu bar, refreshes every 60 seconds, and sends a macOS notification when the quota drops below 20% and again below 10%.

The tray uses the `systray2` package from the node-systray project. If the native tray cannot start on macOS, TokensFlow writes a SwiftBar fallback plugin to:

```text
~/Library/Application Support/SwiftBar/tokensflow.1m.sh
```

That plugin calls:

```bash
npx tokensflow --status
```

`--status` prints SwiftBar-ready output, with the first line formatted as the menu bar label.

If port `3000` is busy and you did not set `PORT`, TokensFlow automatically tries `3001` through `3010` and prints the URL it selected.

Local development:

```bash
npm start
```

`npm start` launches the local app and opens TokensFlow. During development, use:

```bash
npm run dev
```

TokensFlow is also a PWA. From a supported browser, install it as a standalone app from the browser install menu.

## Automatic Local History

When TokensFlow is running, it reads the latest Codex `rate_limits` event directly from local Codex session files. Separately, it records a local history point every 5 minutes. There is no extra setup and no macOS automation to install.

History points are written as JSONL:

```text
~/.tokensflow/snapshots.jsonl
```

This records what TokensFlow has observed from Codex's local files. It does not force Codex to create a new `rate_limits` event.

The UI reads those history points from `/api/history` and renders a local quota timeline for the last 24 hours. If the history file does not exist yet, the timeline shows an empty state instead of failing.

Useful controls:

```bash
TOKENSFLOW_HISTORY=0                    # disable local history recording
TOKENSFLOW_HISTORY_INTERVAL_MS=300000   # default: 5 minutes
TOKENSFLOW_HISTORY_FILE=...             # custom JSONL output path
```

The older `TOKENSFLOW_SNAPSHOT_*` names still work as compatibility aliases, but `TOKENSFLOW_HISTORY_*` is the preferred V3 vocabulary.

## Codex Local File Mode

By default, TokensFlow reads:

- `~/.codex/sessions/**/*.jsonl` for the latest observed Codex `rate_limits` event
- `~/.codex/state_5.sqlite` for local thread/session token usage
- `~/.codex/goals_1.sqlite` for optional local goal metadata

The Codex quota cards only use Codex `rate_limits`. The local token meter is displayed separately as a local session meter and is never used to calculate Codex quota percentage.

When Codex is selected explicitly, TokensFlow does not hide failures behind demo data. If Codex logs or rate limits are unavailable, the app shows an offline or unavailable state.

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
TOKENSFLOW_TOOL=codex               # codex or json
TOKENSFLOW_BUDGET_TOKENS=2000000    # fallback budget when no goal budget exists
TOKENSFLOW_WEEKLY_BUDGET_TOKENS=10000000
TOKENSFLOW_CWD="$PWD"               # project whose latest Codex thread should be watched
TOKENSFLOW_THREAD_ID=...            # optional exact Codex thread id
TOKENSFLOW_CODEX_STATE_DB=...       # optional custom state_5.sqlite path
TOKENSFLOW_CODEX_GOALS_DB=...       # optional custom goals_1.sqlite path
TOKENSFLOW_CODEX_SESSIONS_ROOT=...  # optional custom Codex sessions path
```

Example:

```bash
TOKENSFLOW_SOURCE=codex \
TOKENSFLOW_BUDGET_TOKENS=2000000 \
npm run dev
```

## How Accurate Is It?

TokensFlow is accurate to the latest local Codex `rate_limits` event it can read.

It is not guaranteed to match the Codex UI second-by-second. If Codex has newer quota state in memory but has not written a new session-log event yet, TokensFlow will show the latest local file value and mark the source as `recent`, `idle`, or `old`.

Freshness states:

- `recent`: source observed less than 2 minutes ago
- `idle`: source observed 2-29 minutes ago
- `old`: source observed 30 minutes ago or more
- `offline`: no Codex `rate_limits` event was found

Best use: a beautiful, lightweight local monitor that makes the local Codex quota file easier to see without opening settings.

## Why Not Exact?

Codex may show fresher quota state in its own UI than it has written to local session logs. TokensFlow can only read local files that already exist. That is why the app shows freshness instead of claiming official real-time accuracy.

Local history improves the product experience by preserving what TokensFlow has observed over time, but the current quota cards still come from the latest local Codex `rate_limits` event.

## Local API

TokensFlow exposes local-only endpoints on `127.0.0.1`:

- `GET /api/usage` returns the latest observed local Codex usage.
- `GET /api/history` returns the configured local history.
- `GET /api/snapshots` is kept as a compatibility alias for older builds.
- `POST /api/usage` updates the JSON fallback source for demos or custom local data.

The history endpoints never accept a file path from the browser. They only read the history file configured on the server.

## Privacy And Security

TokensFlow is local-only and has no telemetry.

- See [PRIVACY.md](./PRIVACY.md) for files read, files written, and network behavior.
- See [SECURITY.md](./SECURITY.md) for the security model and reporting guidance.

## Provider Status

Codex is the only supported live provider in this release because Codex stores local session logs and quota events on disk. Claude Code, Cursor, Windsurf, and API-provider adapters should stay out of the CLI until their local data sources are reliable enough to label honestly.

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

- Improve the local quota timeline and history.
- Polish `npx tokensflow` launch behavior and first-run states.
- Improve the macOS tray and SwiftBar fallback polish.
- Add deeper Claude Code and Cursor adapters only when their local data sources are reliable enough to label honestly.

## License

MIT
