# Security

TokensFlow is a local developer tool. It reads local usage logs and serves a
local dashboard on `127.0.0.1`.

## Reporting Issues

Please report security issues privately to the project maintainer before opening
a public issue. Include:

- the affected version
- the command you ran
- the local file path or endpoint involved
- expected vs actual behavior

## Security Model

TokensFlow should never expose local Codex logs over a public network. The local
server binds to `127.0.0.1`, not `0.0.0.0`.

The browser-facing API must not accept arbitrary filesystem paths. In particular:

- `/api/usage` reads from configured local sources only
- `/api/history` reads from the configured local history file only
- `/api/snapshots` is a compatibility alias for `/api/history`
- query parameters must not override history or Codex log paths

## Local Data Risk

Codex session logs can contain sensitive development context. TokensFlow parses
only the local files needed to derive quota, cost, and activity metadata, but
users should still treat `~/.codex` as private data.

## Dependency Risk

TokensFlow keeps runtime dependencies minimal. The tray mode uses `systray2`;
add more dependencies only when they provide clear local utility value.

## Publishing Checklist

Before publishing a new version:

```bash
npm test
npm run check
npm pack --dry-run
```

Review the tarball contents and confirm that no local logs, history files, secrets,
or machine-specific files are included.
