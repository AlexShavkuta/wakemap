<h1 align="center">Wakemap</h1>

<p align="center">
  An interactive map of what your AI coding agent changed in a codebase, and why.<br/>
  Point it at two git revisions and it links every change to the <a href="https://docs.claude.com/en/docs/claude-code">Claude Code</a> session that made it, drawn with <a href="https://reactflow.dev">React Flow</a> and <a href="https://eclipse.dev/elk/">ELK</a>.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#running-it-locally">Running it locally</a> ·
  <a href="#how-it-works">How it works</a>
</p>

## Features

- 🗺️ **Change map** — folders, changed files and the files that depend on them as one flowchart, with new imports in green and removed ones dashed in red
- 🧭 **Scales to big PRs** — large changes open as folders in architecture layers (routes, UI, logic, data) with only changed imports; open any folder in place
- 🔍 **Inside each file** — which functions, components and types were added, modified or removed, and whether an exported signature changed
- 🧠 **Why it changed** — each change is linked to the prompt that caused it and the agent's own words before the edit, quoted from the transcript
- 🐚 **Shell edits traced** — edits made through scripts (`python`, `sed`, heredocs) are attributed, and changes no agent edit explains are called out
- 🎬 **Story mode** — step through the prompts in order with `j` / `k`; each step highlights the files it touched
- 🔒 **Deterministic risk** — rule-based flags for changed contracts, new import cycles, imports that point up the architecture layers, weakened tests, suppressions, new packages and sensitive paths
- ↔️ **Before and after** — one fixed layout for both revisions, so nothing moves when you toggle

## Quick Start

```bash
git clone https://github.com/AlexShavkuta/wakemap.git && cd wakemap
npm install
npm run build:viewer
./bin/wakemap.mjs analyze --repo ../your-repo --base main --head your-branch --out map.json
./bin/wakemap.mjs show map.json
```

Then open http://localhost:4173.

## Running it locally

### Requirements

- Node.js and npm (developed on Node 26)
- git
- A TypeScript or JavaScript repository to analyze
- Optional: Claude Code sessions for that repository on the same machine (in `~/.claude/projects`). Without them you still get the map and the risk flags, but no "why".

### 1. Install

```bash
npm install
npm run build:viewer
```

`build:viewer` builds the web viewer into `viewer/dist`, which `wakemap show` serves.

### 2. Analyze a change

```bash
./bin/wakemap.mjs analyze --repo <path-to-repo> --base <ref> --head <ref> --out map.json
```

| Flag | Meaning |
| --- | --- |
| `--repo` | Repository to analyze (default `.`) |
| `--base` | Revision before the change, e.g. `main` (required) |
| `--head` | Revision after the change (default `HEAD`) |
| `--out` | Where to write the map (default `<repo>/.wakemap/<sha>.json`) |
| `--transcript` | Use these Claude Code transcripts instead of searching `~/.claude/projects` (repeatable) |
| `--root` | Extra checkout path the agent worked in, such as a deleted worktree (repeatable) |
| `--context` | How many unchanged neighbour files to show (default 8) |

For a PR that is already merged, compare the merge commit with its first parent:

```bash
./bin/wakemap.mjs analyze --repo ../your-repo --base <merge-sha>^1 --head <merge-sha> --out map.json
```

The command prints a summary: files changed, prompts linked, changes without an agent edit, and the risk band.

### 3. Open the map

```bash
./bin/wakemap.mjs show map.json --port 4173
```

Click a file to see why it changed, its risk flags, the symbols inside it and the diff. Press `j` / `k` to step through the prompts and `Esc` to clear the selection.

### Working on the viewer

The dev server reads its data from `viewer/public/wakemap.json` and reloads as you edit:

```bash
./bin/wakemap.mjs analyze --repo ../your-repo --base main --head your-branch --out viewer/public/wakemap.json
npm run dev:viewer
```

It runs at http://localhost:5199. Type-check the engine and the viewer with `npm run typecheck`.

## How it works

| Layer | Where | What it does |
| --- | --- | --- |
| Graph | `src/engine` | Parses every file at both revisions with the TypeScript compiler API and resolves imports, including tsconfig path aliases |
| Attribution | `src/intent` | Reads Claude Code JSONL transcripts; an edit counts when the lines it wrote appear in the final diff |
| Risk | `src/risk` | Rules only, and every flag points at a file |
| Viewer | `viewer/` | React Flow canvas with an ELK layered layout |

Three rules hold throughout: the map's nodes and edges come from static analysis, never from an LLM; every "why" is quoted from the agent's transcript; and every risk flag is attached to a file on the map.

Current scope: TypeScript and JavaScript repositories, Claude Code sessions, local use only.

## Research

- [Market research](docs/research/market.md)
- [Implementation research](docs/research/implementation.md)
