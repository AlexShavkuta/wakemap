// The wakemap.json contract shared by the engine and the viewer.
// Rule: every node and edge comes from static analysis. Nothing here is LLM-generated.

export type ChangeStatus = "added" | "modified" | "removed" | "unchanged";

export type SymbolKind = "function" | "component" | "class" | "interface" | "type" | "const" | "enum";

export interface SymbolChange {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  status: ChangeStatus;
  /** True when the exported signature changed, not just the body. */
  signatureChanged: boolean;
  /** 1-based line range in the head revision (base revision for removed symbols). */
  lines: [number, number];
}

export interface FileNode {
  id: string; // repo-relative path
  area: string; // id of the area (top-level grouping) it belongs to
  status: ChangeStatus;
  language: "ts" | "tsx" | "js" | "css" | "json" | "sql" | "md" | "other";
  /** Next.js-style route, if this file defines one. */
  route?: string;
  role?: "page" | "layout" | "api" | "test" | "config" | "style" | "migration";
  linesAdded: number;
  linesRemoved: number;
  symbols: SymbolChange[];
  /** Number of files that import this file at head (blast radius, one hop). */
  importedBy: number;
  /** Files reachable by following importers transitively. */
  blastRadius: number;
  /** True when shown only as context (neighbour of a changed file). */
  context: boolean;
  risk: RiskFlag[];
  /** Change units that touched this file. */
  unitIds: string[];
  hunks: Hunk[];
}

export interface Hunk {
  header: string;
  lines: string[]; // unified diff lines with +/-/space prefix
}

export interface AreaNode {
  id: string;
  label: string;
  /** Architecture layer, 0 = routes at the top, 4 = tests and config at the bottom. */
  layer: number;
  totalFiles: number;
  changed: { added: number; modified: number; removed: number };
}

export interface Edge {
  id: string;
  source: string; // file id
  target: string; // file id (the imported file)
  status: ChangeStatus;
}

export type RiskLevel = "info" | "warn" | "high";

export interface RiskFlag {
  rule: string;
  level: RiskLevel;
  message: string;
  file?: string;
  line?: number;
}

/** One intent: a user prompt and the agent edits it caused. */
export interface ChangeUnit {
  id: string;
  order: number;
  prompt: string;
  promptAt: string;
  /** The agent's message the prompt replied to (verbatim, may be long). */
  promptContext?: string;
  /** What the agent said right before its edits, verbatim (grounded in the transcript). */
  rationale: Evidence[];
  files: string[];
}

export interface Evidence {
  text: string;
  at: string;
  transcript: string;
  uuid: string;
  file?: string;
}

export interface WakeMap {
  version: 1;
  repo: string;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  title: string;
  /** Branch the change came from, when known. */
  branch?: string;
  /** Pull request number, when the head is a GitHub merge commit. */
  pr?: string;
  generatedAt: string;
  /** Names of the layers, indexed by AreaNode.layer. */
  layers: string[];
  areas: AreaNode[];
  files: FileNode[];
  edges: Edge[];
  units: ChangeUnit[];
  risk: { score: number; band: "low" | "review" | "expert"; flags: RiskFlag[] };
  /** Changed files with no agent edit in the transcripts (human or shell edits). */
  unattributed: string[];
  /** Files the agent edited that ended up unchanged in the final diff. */
  reverted: string[];
}
