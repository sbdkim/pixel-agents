# Pixel Agents Codex Reference

This file documents the Codex runtime contract used by Pixel Agents.

## Session Source

- Root: `~/.codex/sessions/`
- Files: `*.jsonl` under date-based folders
- Binding: new terminals are matched to sessions by `session_meta.payload.cwd` and nearest launch timestamp.

## Required Event Signals

- Tool start: top-level record type `response_item` with `payload.type = "function_call"`
  - Tool id: `payload.call_id`
  - Tool name: `payload.name`
  - Arguments: `payload.arguments` (JSON string)
- Tool done: `response_item` with `payload.type = "function_call_output"`
  - Tool id: `payload.call_id`
- Sub-agent source: `response_item` function call with `payload.name = "Task"`
  - Sub-agent id/key: `payload.call_id`
  - Label: `payload.arguments.description` (fallback: `Task`)
- Task start: `event_msg` with `payload.type = "task_started"`
- Task complete: `event_msg` with `payload.type = "task_complete"`
- User message: `event_msg` with `payload.type = "user_message"`

## Extension <-> Webview Messages

- Webview -> Extension:
  - `openCodex`
  - `focusAgent`
  - `closeAgent`
  - `retryAgentBinding`
  - `saveLayout`
  - `saveAgentSeats`
  - `setSoundEnabled`
  - `openCodexSessionsFolder`
  - `exportLayout`
  - `importLayout`
- Extension -> Webview:
  - `agentCreated` / `agentClosed`
  - `agentToolStart` / `agentToolDone` / `agentToolsClear`
  - `subagentToolStart` / `subagentToolDone` / `subagentClear`
  - `agentStatus`
  - `agentBindState`
  - `agentDebugEvent`
  - `existingAgents`
  - `layoutLoaded`
  - `furnitureAssetsLoaded`
  - `floorTilesLoaded`
  - `wallTilesLoaded`
  - `characterSpritesLoaded`
  - `workspaceFolders`
  - `settingsLoaded`

## Notes

- Sub-agent lifecycle states: `started`, `active`, `done`, `orphaned`, `expired`.
- Missing/out-of-order Task events are handled deterministically with timeout-based expiry.
- Permission wait bubbles are disabled because Codex logs do not currently provide a stable blocked-permission signal.
- If an agent is unbound, open Debug View and click `Retry Bind` after starting Codex in the terminal.
