# Wakemap

See what your AI agent left behind.

Wakemap draws your platform as an interactive flowchart (services → modules → files → functions) and overlays the changes an AI coding agent made, why it made them, and how risky they are, so you can review agent work without reading every line of diff.

## Principles

- **The map is deterministic.** Nodes and edges come from static analysis, never from an LLM. LLMs only group and label.
- **Every "why" is grounded.** Rationale must cite the agent's transcript (prompt, tool call, reasoning).
- **Every risk point is attached to the graph.** No free-floating scores.

## Status

Proof of concept. Scope: TypeScript/JavaScript repos, Claude Code sessions, rendered with React Flow + ELK.

## Try it

```bash
npm install
npm run build:viewer
./bin/wakemap.mjs analyze --repo ../your-repo --base main --head your-branch --out map.json
./bin/wakemap.mjs show map.json
```

`analyze` compares two revisions and finds the Claude Code sessions on this machine (`~/.claude/projects`) that made the changes. For a merged PR use the merge commit: `--base <merge>^1 --head <merge>`.

## What it shows

- **The map:** top-level folders as areas, changed files inside them, plus the files that depend on them. Arrows point from a file down to what it imports. New imports are green, removed ones red and dashed.
- **Inside each file:** which functions, components and types were added, modified or removed, and whether an exported signature changed.
- **Why:** each change is linked to the prompt that caused it and the agent's own words right before the edit, quoted from the transcript. Edits made through shell scripts are traced too.
- **Story mode:** step through the prompts in order (`j` / `k`); each step highlights the files it changed.
- **Risk:** deterministic rules. Exported contracts that changed and how many files use them, new import cycles, first-time dependencies between areas, deleted or weakened tests, lint/type suppressions, new packages, sensitive paths, and changes no agent edit explains.

## How it works

| Layer | Where | Notes |
| --- | --- | --- |
| Graph | `src/engine` | TypeScript compiler API parses every file at both revisions; imports resolved with tsconfig paths |
| Attribution | `src/intent` | Reads Claude Code JSONL transcripts; an edit counts when the lines it wrote are in the final diff |
| Risk | `src/risk` | Rules only, every flag points at a file |
| Viewer | `viewer/` | React Flow, ELK layered layout (one layout for before and after) |

## Research

- [Market research](docs/research/market.md)
- [Implementation research](docs/research/implementation.md)
