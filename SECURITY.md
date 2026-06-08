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
- `/api/snapshots` reads from the configured snapshot file only
- query parameters must not override snapshot or Codex log paths

## Local Data Risk

Codex session logs can contain sensitive development context. TokensFlow parses
only the local files needed to derive quota snapshots and activity metadata, but
users should still treat `~/.codex` as private data.

## Dependency Risk

TokensFlow currently has no runtime npm dependencies. Keep it that way unless a
dependency provides clear user value that cannot reasonably be implemented with
the platform.

## Publishing Checklist

Before publishing a new version:

```bash
npm test
npm run check
npm pack --dry-run
```

Review the tarball contents and confirm that no local logs, snapshots, secrets,
or machine-specific files are included.
