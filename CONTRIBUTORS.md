# Contributing to Pixel Agents

Thanks for your interest in contributing.

## Prerequisites

- Node.js (LTS recommended)
- VS Code (v1.107.0+)
- Codex CLI available as `codex.cmd`

## Setup

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Press **F5** to launch the Extension Development Host.

## Development Workflow

```bash
npm run watch
```

Note: `watch` does not rebuild the Vite webview bundle. After webview changes, run `npm run build:webview` (or full `npm run build`).

## Code Guidelines

- Keep constants centralized:
  - `src/constants.ts`
  - `webview-ui/src/constants.ts`
  - `webview-ui/src/index.css` (`--pixel-*` variables)
- Keep strict TypeScript hygiene (`noUnusedLocals`, `noUnusedParameters`)

## Pull Requests

1. Create a branch from `main`
2. Implement changes
3. Verify with:

```bash
npm run build
```

4. Open a PR with:
- clear change summary
- test/verification notes
- screenshots or GIFs for UI changes

## Reporting Issues

Open an issue with expected behavior, actual behavior, reproduction steps, VS Code version, and OS.

## Code of Conduct

This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
