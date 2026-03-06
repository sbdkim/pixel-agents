# Changelog

## v1.1.0

### Breaking Changes

- Migrated runtime from legacy provider-specific session tracking to Codex-only session tracking.
- Removed legacy message legacy launch message; webview now uses `openCodex`.

### Features

- Launches `codex.cmd` directly from the `+ Agent` action.
- Auto-binds each new agent to the nearest Codex session by `cwd` and launch timestamp.
- Uses Codex event stream (`task_started`, `task_complete`, `function_call`, `function_call_output`) for activity animation.

### Maintenance

- Removed legacy SDK dependency and provider-specific vision script integration.
- Updated docs and project metadata to Codex-only behavior.

## v1.0.2

### Bug Fixes

- macOS path sanitization and file watching reliability.

### Features

- Workspace folder picker for multi-root workspaces.

## v1.0.1

Initial public release.

