# Pixel Agents

A VS Code extension that turns your Codex terminals into animated pixel art characters in a virtual office.

Each Codex terminal you open spawns a character that walks around, sits at desks, and visually reflects what the agent is doing: typing when running tools, reading when inspecting files, and waiting when a task completes.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Features

- One agent, one character: every Codex terminal gets its own animated character
- Live activity tracking: characters animate from Codex session logs in real time
- Office layout editor: design your office with floors, walls, and furniture
- Speech bubbles: visual waiting indicators when a task is done
- Sound notifications: optional chime on task completion
- Persistent layouts: your office design is saved and shared across VS Code windows

## Requirements

- VS Code 1.107.0 or later
- Codex CLI (`codex.cmd`) installed and available in your shell

## Getting Started (Developer)

```bash
git clone https://github.com/sbdkim/pixel-agents.git
cd pixel-agents
git checkout CodexAgent
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

## First Run in Extension Development Host

1. In the **Extension Development Host** window, open a real folder:
   - `File -> Open Folder...`
2. Open Command Palette:
   - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
3. Run:
   - `Pixel Agents: Show Panel`
4. In the panel, click **+ Agent** to launch a Codex terminal + character.
5. Use the spawned terminal normally; the character state updates from Codex session logs.
6. Click **Layout** to customize your office.

## Usage Tips

- If `+ Agent` shows `Open a workspace folder before starting an agent`, make sure you used `File -> Open Folder...` in the Extension Development Host (not just the original VS Code window).
- If the panel is not visible, run `Pixel Agents: Show Panel` again from Command Palette.
- To inspect binding/session issues, open **Debug** mode in the panel and use **Retry Bind**.

## Codex Session Tracking

Pixel Agents watches Codex session logs under `~/.codex/sessions/`.

Runtime signals used:

- Tool start: `response_item.payload.type = "function_call"`
- Tool done: `response_item.payload.type = "function_call_output"`
- Turn start: `event_msg.payload.type = "task_started"`
- Turn done: `event_msg.payload.type = "task_complete"`
- User message: `event_msg.payload.type = "user_message"`

Sub-agent visualization contract:

- `Task` function calls (`name === "Task"`) create a sub-agent keyed by `call_id`
- Sub-agent label uses `arguments.description` (fallback: `Task`)
- Matching `function_call_output` marks the sub-agent done
- Missing/invalid lifecycle is reconciled via timeout + deterministic cleanup

When you click `+ Agent`, Pixel Agents launches `codex.cmd` and auto-binds the new character to the nearest matching Codex session by `cwd` and launch time.

If an agent cannot bind, open **Debug** mode and use **Retry Bind** after confirming Codex is running in that terminal.

## Layout Editor

- Floor and wall painting with color controls
- Furniture placement, rotation, and selection
- Undo/Redo with keyboard shortcuts
- Export/Import layout JSON

## Office Assets

The office tileset used in this project is **[Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset)** by **Donarg** (paid, third-party).

This repository does not include those paid assets. To import compatible furniture assets locally, run:

```bash
npm run import-tileset
```

## Tech Stack

- Extension: TypeScript, VS Code Webview API, esbuild
- Webview: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- Agent-terminal sync can still desync in edge cases when terminals are rapidly created/closed
- Session binding depends on Codex log schema and can fail if upstream schema changes
- Sub-agent lifecycle depends on stable `Task` tool events in Codex logs
- Timed expiry is used as fail-safe when `function_call_output` is missing
- Tested primarily on Windows 11

## Contributions

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for contribution instructions.

## License

This project is licensed under the [MIT License](LICENSE).
