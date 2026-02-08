# Arcadia

VS Code extension with an embedded React webview panel.

## Architecture

```
├── src/extension.ts          — Extension entry point. Registers a WebviewViewProvider
│                               that loads the built React app into the bottom panel.
├── webview-ui/               — Standalone React + TypeScript app (Vite)
│   ├── src/App.tsx           — Root component (agent launcher + session buttons)
│   └── vite.config.ts        — Builds to ../dist/webview with relative base paths
├── esbuild.js                — Bundles the extension (src/) → dist/extension.js
├── dist/                     — Build output (gitignored)
│   ├── extension.js          — Bundled extension
│   └── webview/              — Built React app (loaded by extension at runtime)
└── package.json              — VS Code manifest + all build scripts
```

## Vocabulary

- **Terminal**: The actual VS Code terminal window running Claude Code. A terminal is a physical resource — it exists as long as the VS Code terminal tab is open.
- **Session**: A single Claude Code conversation, identified by a JSONL file (`<session-id>.jsonl`). Sessions are permanent and immutable — once created, a session's identity never changes.
- **Agent**: A UI element in the Arcadia webview, permanently bound to exactly one terminal. One agent per terminal, created immediately when the terminal is launched. Clicking the agent focuses its terminal. When the terminal closes, the agent is removed.

## How it works

- The extension registers a `WebviewViewProvider` for the view `arcadia.panelView`, which lives in the bottom panel (next to Terminal).
- On resolve, it reads `dist/webview/index.html` and rewrites `./` asset paths to `webview.asWebviewUri()` URIs.
- The command `arcadia.showPanel` focuses the panel.
- **One-agent-per-terminal model**: Each "Open Claude Code" click creates a terminal and immediately creates an agent bound to it. The agent button appears right away (before the JSONL file exists). A background 1s poll waits for the specific `<uuid>.jsonl` file, then starts file watching. No adopted terminals.
- **`/clear` detection**: The extension tracks all known JSONL files in the project directory. When a new unknown file appears, it is assigned to the currently-active agent (the one whose terminal is focused). This works because `/clear` is typed in the focused terminal, and the new JSONL file it creates is the only "unknown" file. The agent's file watching is swapped to the new file and activity is cleared.
- **Terminal ↔ agent selection sync**: `onDidChangeActiveTerminal` tracks which agent is active and sends `agentSelected` to the webview so the UI highlights the matching agent when the user switches terminal tabs.
- The webview communicates with the extension via `postMessage`. Clicking "Open Claude Code" sends `openClaude`, the extension creates a named terminal running `claude --session-id <uuid>` and immediately sends `agentCreated`. Each agent gets an "Agent #n" button; clicking it sends `focusAgent` to show the hosting terminal. Each agent button has a close (✕) button that sends `closeAgent` to dispose of the terminal. Closing a terminal (manually or via the close button) sends `agentClosed` to remove its button.
- The webview sends `webviewReady` on mount; the extension responds with `existingAgents` containing all tracked agent IDs.

## Build

```sh
npm install                   # root deps
cd webview-ui && npm install  # webview deps
cd .. && npm run build        # builds both extension + webview
```

`npm run build` runs: type-check → lint → esbuild (extension) → vite build (webview).

## Dev

Press F5 to launch the Extension Development Host. The "Arcadia" tab appears in the bottom panel. Run "Arcadia: Show Panel" from the command palette to focus it.

## Key decisions

- Used `WebviewViewProvider` (not `WebviewPanel`) so the view sits in the panel area alongside the terminal rather than in an editor tab.
- Inline esbuild problem matcher in `.vscode/tasks.json` to avoid requiring the `connor4312.esbuild-problem-matchers` extension.
- Webview is a separate Vite project with its own `node_modules` and `tsconfig`. Root `tsconfig.json` excludes `webview-ui/`.

## Agent Status Tracking

Real-time display of what each Claude Code agent is doing (e.g., "Reading App.tsx", "Running: npm test").

### How it works

1. **Transcript JSONL**: Claude Code writes real-time JSONL transcripts to `~/.claude/projects/<project-hash>/<session-id>.jsonl`. The project hash is the workspace path with `:` `\` `/` replaced by `-` (e.g., `C:\Users\Developer\Desktop\Arcadia` → `C--Users-Developer-Desktop-Arcadia`).
2. **`--session-id` for deterministic file matching**: Extension generates a UUID per terminal and passes `claude --session-id <uuid>`. The JSONL file is then `<uuid>.jsonl` — no race conditions with parallel agents.
3. **Immediate agent creation**: Agent is created as soon as the terminal is launched (before the JSONL file exists). A 1s poll waits for the specific `<uuid>.jsonl` file to appear, then starts file watching.
3b. **`/clear` reassignment**: A project-level 1s scan watches for unknown JSONL files. Known files are seeded on first scan + pre-registered for each `--session-id`. When an unknown file appears and an agent's terminal is focused, that agent is reassigned to the new file (old watching stops, activity clears, new watching starts).
4. **File watching**: Once the JSONL file is found, extension watches it using hybrid `fs.watch` (instant) + 2s polling (backup). Includes partial line buffering to handle mid-write reads.
5. **Parsing**: Each JSONL line is a complete record with a top-level `type` field:
   - `"assistant"` records contain `message.content[]` with `tool_use` blocks (`id`, `name`, `input`)
   - `"user"` records contain `message.content[]` with `tool_result` blocks, OR `content` as a string (text prompt)
   - `"system"` records with `subtype: "turn_duration"` mark turn completion (reliable signal)
   - `"progress"` records contain sub-agent activity (ignored for now)
   - `"file-history-snapshot"` records track file state (ignored)
   - `"assistant"` records can also have `content: [{type: "thinking"}]` — reasoning blocks, not text
   - Tool IDs match 1:1 between `tool_use.id` and `tool_result.tool_use_id`
6. **Messages to webview**:
   - `agentCreated { id }` — when a terminal is created and agent is bound to it
   - `agentClosed { id }` — when terminal closes
   - `openSessionsFolder` — opens the JSONL project directory in file explorer
   - `agentToolStart { id, toolId, status }` — when a tool_use block is found
   - `agentToolDone { id, toolId }` — when a matching tool_result block is found (300ms delayed)
   - `agentToolsClear { id }` — when a new user prompt is detected (clears stacked tools)
   - `agentStatus { id, status: 'waiting' | 'active' }` — when agent finishes turn or starts new work
   - `existingAgents { agents: number[] }` — sent on webview reconnect
7. **Webview rendering**: Flat list of agent cards (no folders). "Open Claude Code" and "Sessions" buttons at top. Tools stack vertically below each agent button. Active tools show a blue pulsing dot; completed tools show a green solid dot (dimmed). When agent is waiting for input (no active tools + status='waiting'), shows amber dot with "Waiting for input".

### Key lessons learned

- **Previous failed approach**: Hook-based file IPC (documented in `.claude/agent-status-attempt.md`). Hooks are captured at session startup, terminal env vars don't propagate to hook subprocesses. Transcript watching is much simpler.
- **`fs.watch` is unreliable on Windows**: Sometimes misses events. Always pair with polling as a backup.
- **Partial line buffering is essential**: When reading an append-only file, the last line may be incomplete (mid-write). Only process lines terminated by `\n`; carry the remainder to the next read.
- **Flickering / instant completion**: For fast tools (~1s like Read), `tool_use` and `tool_result` arrive in the same `readNewLines` batch. Without a delay, React batches both state updates into a single render and the user never sees the blue active state. Fixed by delaying `agentToolDone` messages by 300ms.
- **`--session-id` for multi-agent**: Each terminal gets `claude --session-id <uuid>` so the JSONL filename is deterministic (`<uuid>.jsonl`). Eliminates race conditions when parallel agents share the same project directory.
- **User prompts can be string or array**: `record.message.content` is a string for text prompts, an array for tool results. Must handle both forms to properly clear tools/status on new prompts.
- **`/clear` creates a new JSONL file**: The `/clear` command is recorded in the NEW file's first records, not the old file. The old file simply stops receiving writes.
- **`--output-format stream-json` requires non-TTY stdin**: Cannot be used with VS Code terminals (Ink TUI requires TTY). Transcript JSONL watching is the alternative.
- **Text-only assistant records are often intermediate**: In the JSONL, text and tool_use from the same API response are written as separate records. A text-only `assistant` record is frequently followed by a `tool_use` record (not a turn end). The reliable turn-end signal is `system` records with `subtype: "turn_duration"`. Text-only assistant records use a 2s debounce timer as a fallback.
- **No `summary`/`result` record types exist**: Turn completion is signaled by `system` records with `subtype: "turn_duration"`, not `summary` or `result`.

### Extension state

**Consolidated `AgentState` struct** (per agent):
```
id, terminalRef, projectDir, jsonlFile, fileOffset, lineBuffer,
activeToolIds, activeToolStatuses, isWaiting
```

**Provider-level state**:
```
agents               — agentId → AgentState (consolidated agent state)
activeAgentId        — which agent's terminal is currently focused (null if none)
knownJsonlFiles      — Set<string> of all JSONL paths seen (seeded on first scan + pre-registered per --session-id)
projectScanTimer     — setInterval (1s project-level scan for /clear detection)
jsonlPollTimers      — agentId → setInterval (1s poll for JSONL file to appear)
fileWatchers         — agentId → fs.FSWatcher
pollingTimers        — agentId → setInterval (2s backup file polling)
waitingTimers        — agentId → setTimeout (2s debounce for "waiting" status)
```

No persistence (`workspaceState`) is used. No adopted terminals. Agents only exist for terminals launched from the extension.

## Memory

Keep all memories and notes in this file (CLAUDE.md), not in `~/.claude/` memory files.

### Key patterns
- `crypto.randomUUID()` works in VS Code extension host
- Terminal `cwd` option sets working directory at creation; `!cd` does NOT work mid-session
- `/add-dir <path>` grants a running session access to an additional directory
- To change cwd, must close session and restart with new `cwd` terminal option

### Windows-MCP (desktop automation)
- Installed as user-scoped MCP server via `uvx --python 3.13 windows-mcp`
- Tools: `Snapshot`, `Click`, `Type`, `Scroll`, `Move`, `Shortcut`, `App`, `Shell`, `Wait`, `Scrape`
- `Snapshot(use_vision=true)` returns screenshot + interactive element coordinates
- Webview buttons show coords `(0,0)` in accessibility tree — must use vision coordinates instead
- **Before clicking in Extension Dev Host, snap both VS Code windows side-by-side on the SAME screen** (user has dual monitors; otherwise clicks land on the wrong window)
- Extension Dev Host starts at x=960 when snapped to right half of 1920-wide monitor
- Remember to click the reload button on the top of the main VS Code window to reload the extension after building.
