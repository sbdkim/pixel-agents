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
- Task start: `event_msg` with `payload.type = "task_started"`
- Task complete: `event_msg` with `payload.type = "task_complete"`
- User message: `event_msg` with `payload.type = "user_message"`

## Extension <-> Webview Messages

- Webview -> Extension:
  - `openCodex`
  - `focusAgent`
  - `closeAgent`
  - `saveLayout`
  - `saveAgentSeats`
  - `setSoundEnabled`
  - `openCodexSessionsFolder`
  - `exportLayout`
  - `importLayout`
- Extension -> Webview:
  - `agentCreated` / `agentClosed`
  - `agentToolStart` / `agentToolDone` / `agentToolsClear`
  - `agentStatus`
  - `existingAgents`
  - `layoutLoaded`
  - `furnitureAssetsLoaded`
  - `floorTilesLoaded`
  - `wallTilesLoaded`
  - `characterSpritesLoaded`
  - `workspaceFolders`
  - `settingsLoaded`

## Notes

- Sub-agent visualization is disabled in the Codex v1 runtime.
- Permission wait bubbles are disabled because Codex logs do not currently provide a stable blocked-permission signal.
