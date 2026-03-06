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

## Getting Started

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

## Usage

1. Open the **Pixel Agents** panel
2. Click **+ Agent** to spawn a new Codex terminal and character
3. Start working in Codex and watch the character react in real time
4. Click **Layout** to customize your office

## Codex Session Tracking

Pixel Agents watches Codex session logs under `~/.codex/sessions/`.

Runtime signals used:

- Tool start: `response_item.payload.type = "function_call"`
- Tool done: `response_item.payload.type = "function_call_output"`
- Turn start: `event_msg.payload.type = "task_started"`
- Turn done: `event_msg.payload.type = "task_complete"`
- User message: `event_msg.payload.type = "user_message"`

When you click `+ Agent`, Pixel Agents launches `codex.cmd` and auto-binds the new character to the nearest matching Codex session by `cwd` and launch time.

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
- Tested primarily on Windows 11

## Contributions

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for contribution instructions.

## License

This project is licensed under the [MIT License](LICENSE).
