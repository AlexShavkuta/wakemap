# Wake

See what your AI agent left behind.

Wake draws your platform as an interactive flowchart (services → modules → files → functions) and overlays the changes an AI coding agent made, why it made them, and how risky they are, so you can review agent work without reading every line of diff.

## Principles

- **The map is deterministic.** Nodes and edges come from static analysis, never from an LLM. LLMs only group and label.
- **Every "why" is grounded.** Rationale must cite the agent's transcript (prompt, tool call, reasoning).
- **Every risk point is attached to the graph.** No free-floating scores.

## Status

Proof of concept. Scope: Claude Code sessions on a TypeScript repo, rendered with React Flow + ELK.

## Research

- [Market research](docs/research/market.md)
- [Implementation research](docs/research/implementation.md)
