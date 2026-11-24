import { resolve } from "node:path";
import { Git } from "./engine/git.ts";
import { areaOf, blastRadius, buildGraph, LAYERS, layerOf, routeOf, type RepoGraph } from "./engine/graph.ts";
import type { ParsedSymbol } from "./engine/parse.ts";
import { findTranscripts, mergeLogs, readTranscript, type AgentEdit } from "./intent/transcript.ts";
import type { AreaNode, ChangeStatus, ChangeUnit, Edge, FileNode, RiskFlag, SymbolChange, WakeMap } from "./model.ts";
import { fileRisk, isTest, scoreRisk } from "./risk/rules.ts";

export interface AnalyzeOptions {
  repo: string;
  base: string;
  head: string;
  transcripts?: string[];
  roots?: string[];
  /** Max neighbour files shown around the change. */
  contextLimit?: number;
}

const significant = (l: string) => {
  const t = l.trim();
  return t.length >= 4 && !/^[\s{}()[\];,<>/]*$/.test(t);
};

function languageOf(p: string): FileNode["language"] {
  const ext = p.split(".").pop() ?? "";
  if (["ts", "mts", "cts"].includes(ext)) return "ts";
  if (ext === "tsx" || ext === "jsx") return "tsx";
  if (["js", "mjs", "cjs"].includes(ext)) return "js";
  if (["css", "scss"].includes(ext)) return "css";
  if (ext === "json" || ext === "jsonc") return "json";
  if (ext === "sql") return "sql";
  if (ext === "md" || ext === "mdx") return "md";
  return "other";
}

function roleOf(p: string): FileNode["role"] {
  const r = routeOf(p).role;
  if (r) return r;
  if (isTest(p)) return "test";
  if (/\.(css|scss)$/.test(p)) return "style";
  if (/(^|\/)migrations?\//.test(p)) return "migration";
  if (/(^|\/)(package\.json|tsconfig.*\.json|.*\.config\.(t|j|m)s|wrangler\.(toml|jsonc?))$/.test(p)) return "config";
  return undefined;
}

function diffSymbols(before: ParsedSymbol[] | undefined, after: ParsedSymbol[] | undefined): SymbolChange[] {
  const key = (s: ParsedSymbol) => `${s.kind === "component" ? "function" : s.kind}:${s.name}`;
  const b = new Map((before ?? []).map((s) => [key(s), s]));
  const a = new Map((after ?? []).map((s) => [key(s), s]));
  const out: SymbolChange[] = [];
  for (const [k, s] of a) {
    const old = b.get(k);
    if (!old) out.push({ name: s.name, kind: s.kind, exported: s.exported, status: "added", signatureChanged: false, lines: [s.start, s.end] });
    else if (old.bodyHash !== s.bodyHash || old.exported !== s.exported)
      out.push({
        name: s.name,
        kind: s.kind,
        exported: s.exported,
        status: "modified",
        signatureChanged: old.signatureHash !== s.signatureHash || old.exported !== s.exported,
        lines: [s.start, s.end],
      });
  }
  for (const [k, s] of b) if (!a.has(k)) out.push({ name: s.name, kind: s.kind, exported: s.exported, status: "removed", signatureChanged: true, lines: [s.start, s.end] });
  return out.sort((x, y) => x.lines[0] - y.lines[0]);
}

function worktreeRoots(git: Git): string[] {
  try {
    return git
      .run(["worktree", "list", "--porcelain"])
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice(9));
  } catch {
    return [git.repo];
  }
}

export function analyze(opts: AnalyzeOptions): WakeMap {
  const repo = resolve(opts.repo);
  const git = new Git(repo);
  const baseSha = git.sha(opts.base);
  const headSha = git.sha(opts.head);
  const gBase = buildGraph(git, baseSha);
  const gHead = buildGraph(git, headSha);

  const status = git.nameStatus(baseSha, headSha);
  const numstat = git.numstat(baseSha, headSha);
  const hunks = git.hunks(baseSha, headSha);
  const renamedFrom = new Map(status.filter((s) => s.oldPath).map((s) => [s.path, s.oldPath!]));
  const renamedTo = new Map([...renamedFrom].map(([n, o]) => [o, n]));

  const changed = new Map<string, ChangeStatus>();
  for (const s of status) changed.set(s.path, s.status === "A" ? "added" : s.status === "D" ? "removed" : "modified");

  // ---- which files to show: every changed file plus its closest neighbours
  const neighbourScore = new Map<string, number>();
  const bump = (f: string) => !changed.has(f) && neighbourScore.set(f, (neighbourScore.get(f) ?? 0) + 1);
  // Neighbours worth showing: files that depend on the change (who could break), and files the
  // change newly started importing. Plain dependencies like shared types and utils are left out.
  for (const [f, st] of changed) {
    const g = st === "removed" ? gBase : gHead;
    for (const n of g.importers.get(f) ?? []) bump(n);
    const before = gBase.imports.get(renamedFrom.get(f) ?? f) ?? new Set<string>();
    for (const n of gHead.imports.get(f) ?? []) if (!before.has(n)) bump(n);
  }
  const limit = opts.contextLimit ?? 8;
  const context = [...neighbourScore].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([f]) => f);
  const visible = new Set([...changed.keys(), ...context]);

  // ---- agent sessions
  const roots = [...new Set([repo, ...worktreeRoots(git), ...(opts.roots ?? []).map((r) => resolve(r))])].sort((a, b) => b.length - a.length);
  const transcriptFiles = opts.transcripts ?? findTranscripts(roots);
  const all = mergeLogs(transcriptFiles.map((t) => readTranscript(t, roots)));
  const rootOf = (p: string) => roots.find((x) => p === x || p.startsWith(x + "/")) ?? "";
  const rel = (p: string) => {
    const r = rootOf(p);
    return r ? p.slice(r.length + 1) : p;
  };

  // Scope sessions to this change. Best signal: a worktree whose checkout is a commit of this change.
  // Fallback: edits made between shortly before the first commit and the last commit of the range.
  const inRange = (sha: string) => {
    try {
      git.run(["merge-base", "--is-ancestor", sha, headSha]);
    } catch {
      return false;
    }
    try {
      git.run(["merge-base", "--is-ancestor", sha, baseSha]);
      return false;
    } catch {
      return true;
    }
  };
  const branchRoots = new Set(
    roots.filter((r) => {
      try {
        return inRange(new Git(r).sha("HEAD"));
      } catch {
        return false;
      }
    }),
  );
  const times = git.run(["log", "--no-merges", "--format=%cI", `${baseSha}..${headSha}`]).split("\n").filter(Boolean).map((t) => Date.parse(t));
  const windowStart = (times.length ? Math.min(...times) : Date.parse(git.run(["log", "-1", "--format=%cI", headSha]))) - 2 * 86400_000;
  const windowEnd = (times.length ? Math.max(...times) : Date.parse(git.run(["log", "-1", "--format=%cI", headSha]))) + 15 * 60_000;
  const log = {
    prompts: all.prompts,
    edits: all.edits.filter((e) => {
      const t = Date.parse(e.at);
      if (t < windowStart || t > windowEnd) return false;
      return branchRoots.size === 0 || branchRoots.has(rootOf(e.path));
    }),
  };

  // added lines per file at head, with their line numbers
  const addedLines = new Map<string, Map<string, number[]>>();
  for (const [f, hs] of hunks) {
    const m = new Map<string, number[]>();
    for (const h of hs) {
      let n = h.newStart;
      for (const l of h.lines) {
        if (l.startsWith("+")) {
          const t = l.slice(1).trim();
          if (significant(t)) m.set(t, [...(m.get(t) ?? []), n]);
          n++;
        } else if (l.startsWith(" ")) n++;
      }
    }
    addedLines.set(f, m);
  }

  const matchLines = (written: string[], added: Map<string, number[]>) => {
    const lines = new Set<number>();
    let hits = 0;
    for (const chunk of written)
      for (const l of chunk.split("\n")) {
        // shell scripts quote what they write: strip quotes and escapes before comparing
        const t = l.trim().replace(/^["'`]+|["'`,)]+$/g, "").replace(/\\n/g, "").trim();
        if (!significant(t)) continue;
        const hitLines: number[] | undefined = added.get(t) ?? added.get(l.trim());
        if (hitLines) (hits++, hitLines.forEach((n) => lines.add(n)));
      }
    return { hits, lines: [...lines] };
  };

  // An edit "landed" when lines it wrote are among the added lines of the final diff.
  const landed: { edit: AgentEdit; file: string; lines: number[] }[] = [];
  const editedFiles = new Map<string, Set<string>>(); // transcript -> "root|file" the agent wrote to
  const noteEdited = (e: AgentEdit, file: string) => {
    if (!editedFiles.has(e.transcript)) editedFiles.set(e.transcript, new Set());
    editedFiles.get(e.transcript)!.add(`${rootOf(e.path)}|${file}`);
  };
  for (const e of log.edits) {
    if (e.tool === "Bash") {
      // a shell command can write any file it names
      const dir = rel(e.shellRoot ?? "");
      const cmd = e.written[0];
      for (const file of changed.keys()) {
        const local = dir && file.startsWith(dir + "/") ? file.slice(dir.length + 1) : file;
        if (!cmd.includes(local)) continue;
        noteEdited(e, file);
        const added = addedLines.get(file);
        if (!added) continue;
        const { hits, lines } = matchLines(e.written, added);
        if (hits > 0) landed.push({ edit: e, file, lines });
      }
      continue;
    }
    const file = rel(e.path);
    noteEdited(e, file);
    const added = addedLines.get(file);
    if (!added) continue;
    const { hits, lines } = matchLines(e.written, added);
    if (hits > 0) landed.push({ edit: e, file, lines });
  }
  const sessionRoots = new Set(landed.map((l) => rootOf(l.edit.path)));
  const sessionTranscripts = new Set(landed.map((l) => l.edit.transcript));

  // ---- change units = prompts that caused landed edits
  const unitByPrompt = new Map<string, ChangeUnit>();
  for (const { edit, file } of landed) {
    const p = log.prompts.get(edit.promptKey);
    if (!p) continue;
    let u = unitByPrompt.get(p.key);
    if (!u) {
      u = { id: `u${unitByPrompt.size + 1}`, order: 0, prompt: p.text, promptAt: p.at, promptContext: p.context?.slice(0, 2000), rationale: [], files: [] };
      unitByPrompt.set(p.key, u);
    }
    if (!u.files.includes(file)) u.files.push(file);
    if (edit.narration && !u.rationale.some((r) => r.uuid === edit.narration!.uuid))
      u.rationale.push({ text: edit.narration.text, at: edit.narration.at, transcript: edit.transcript, uuid: edit.narration.uuid, file });
  }
  const units = [...unitByPrompt.values()].sort((a, b) => a.promptAt.localeCompare(b.promptAt));
  units.forEach((u, i) => ((u.order = i + 1), (u.id = `u${i + 1}`)));

  const unattributed = [...changed.keys()].filter((f) => !landed.some((l) => l.file === f));
  const reverted = [
    ...new Set(
      [...editedFiles]
        .filter(([t]) => sessionTranscripts.has(t))
        .flatMap(([, fs]) => [...fs])
        .filter((k) => sessionRoots.has(k.split("|")[0]))
        .map((k) => k.split("|")[1])
        .filter((f) => !changed.has(f)),
    ),
  ];

  // ---- file nodes
  const files: FileNode[] = [];
  for (const id of visible) {
    const st = changed.get(id) ?? "unchanged";
    const g: RepoGraph = st === "removed" ? gBase : gHead;
    const before = gBase.parsed.get(renamedFrom.get(id) ?? id)?.symbols;
    const after = gHead.parsed.get(id)?.symbols;
    const symbols = st === "unchanged" ? [] : diffSymbols(st === "added" ? [] : before, st === "removed" ? [] : after);
    const [a, r] = numstat.get(id) ?? [0, 0];
    const { route } = routeOf(id);
    const node: FileNode = {
      id,
      area: areaOf(id),
      status: st,
      language: languageOf(id),
      route,
      role: roleOf(id),
      linesAdded: a,
      linesRemoved: r,
      symbols,
      importedBy: g.importers.get(id)?.size ?? 0,
      blastRadius: blastRadius(g, id),
      context: st === "unchanged",
      risk: [],
      unitIds: units.filter((u) => u.files.includes(id)).map((u) => u.id),
      hunks: (hunks.get(id) ?? []).map((h) => ({ header: h.header, lines: h.lines.slice(0, 300) })),
    };
    node.risk = fileRisk(node);
    if (st !== "unchanged" && unattributed.includes(id) && log.edits.length > 0)
      // content and data files are often generated by scripts; code edited off the record matters more
      node.risk.push({
        rule: "unattributed",
        level: node.language === "ts" || node.language === "tsx" || node.language === "js" || node.language === "sql" ? "warn" : "info",
        file: id,
        message: "Changed outside the agent's recorded edits (by hand, a shell command, or another session)",
      });
    files.push(node);
  }

  // ---- edges between visible files
  const edges: Edge[] = [];
  const headEdges = new Set<string>();
  for (const s of visible)
    for (const t of gHead.imports.get(s) ?? [])
      if (visible.has(t)) {
        const key = `${s}->${t}`;
        headEdges.add(key);
        const bs = renamedFrom.get(s) ?? s;
        const bt = renamedFrom.get(t) ?? t;
        const existed = gBase.imports.get(bs)?.has(bt) ?? false;
        edges.push({ id: key, source: s, target: t, status: existed ? "unchanged" : "added" });
      }
  for (const [s, ts] of gBase.imports) {
    const hs = renamedTo.get(s) ?? s;
    if (!visible.has(hs)) continue;
    for (const t of ts) {
      const ht = renamedTo.get(t) ?? t;
      if (visible.has(ht) && !headEdges.has(`${hs}->${ht}`)) edges.push({ id: `${hs}->${ht}`, source: hs, target: ht, status: "removed" });
    }
  }

  // ---- architecture: a new import between two areas that never depended on each other before
  const areaDeps = new Set<string>();
  for (const [s, ts] of gBase.imports) for (const t of ts) if (areaOf(s) !== areaOf(t)) areaDeps.add(`${areaOf(s)}->${areaOf(t)}`);
  for (const e of edges) {
    if (e.status !== "added") continue;
    const [sa, ta] = [areaOf(e.source), areaOf(e.target)];
    if (sa === ta || areaDeps.has(`${sa}->${ta}`)) continue;
    areaDeps.add(`${sa}->${ta}`);
    const reverse = [...gBase.imports].some(([s, ts]) => areaOf(s) === ta && [...ts].some((t) => areaOf(t) === sa));
    const [ls, lt] = [layerOf(sa), layerOf(ta)];
    const upward = ls < 4 && lt < 4 && lt < ls;
    const node = files.find((f) => f.id === e.source);
    node?.risk.push({
      rule: upward ? "layer-violation" : "new-area-dependency",
      level: reverse || upward ? "high" : "warn",
      file: e.source,
      message: reverse
        ? `First import from ${sa} into ${ta}, which already depends on ${sa}: a cycle between areas`
        : upward
          ? `${LAYERS[ls]} code now imports ${LAYERS[lt]} code (${sa} → ${ta})`
          : `First time ${sa} imports from ${ta} (${e.target.split("/").pop()})`,
    });
  }

  // ---- new import cycles: an added edge s -> t where t already reaches s at head but did not at base
  const reaches = (g: RepoGraph, from: string, to: string) => {
    const seen = new Set<string>([from]);
    const stack = [from];
    while (stack.length) {
      const f = stack.pop()!;
      if (f === to) return true;
      for (const n of g.imports.get(f) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
    }
    return false;
  };
  const cycleSeen = new Set<string>();
  for (const e of edges) {
    if (e.status !== "added" || !reaches(gHead, e.target, e.source)) continue;
    const pair = [e.source, e.target].sort().join("|");
    if (cycleSeen.has(pair)) continue;
    cycleSeen.add(pair);
    const bs = renamedFrom.get(e.source) ?? e.source;
    const bt = renamedFrom.get(e.target) ?? e.target;
    if (gBase.parsed.has(bs) && gBase.parsed.has(bt) && reaches(gBase, bt, bs) && gBase.imports.get(bs)?.has(bt)) continue;
    files.find((f) => f.id === e.source)?.risk.push({
      rule: "import-cycle",
      level: "warn",
      file: e.source,
      message: gHead.imports.get(e.target)?.has(e.source)
        ? `New import cycle: ${e.source.split("/").pop()} and ${e.target.split("/").pop()} import each other`
        : `New import cycle: ${e.source.split("/").pop()} now imports ${e.target.split("/").pop()}, which already depends on it`,
    });
  }

  // ---- areas
  const areaIds = new Set(files.map((f) => f.area));
  const areas: AreaNode[] = [...areaIds].sort().map((id) => {
    const fs = files.filter((f) => f.area === id);
    return {
      id,
      label: id,
      layer: layerOf(id),
      totalFiles: [...gHead.files].filter((f) => areaOf(f) === id).length,
      changed: {
        added: fs.filter((f) => f.status === "added").length,
        modified: fs.filter((f) => f.status === "modified").length,
        removed: fs.filter((f) => f.status === "removed").length,
      },
    };
  });

  const flags: RiskFlag[] = files.flatMap((f) => f.risk);
  const risk = { ...scoreRisk(flags, 0), flags };
  // A merge commit's subject ("Merge pull request #39 from ...") says nothing; use the branch tip's subject.
  const [subject, ...parents] = git.run(["log", "-1", "--format=%s%n%P", headSha]).trim().split("\n");
  const parentList = (parents[0] ?? "").split(" ").filter(Boolean);
  const branch = subject.match(/^Merge (?:pull request #\d+ from [^/\s]+\/|branch ')([^'\s]+)/)?.[1];
  const title = parentList.length > 1 ? git.run(["log", "-1", "--format=%s", parentList[1]]).trim() : subject;

  return {
    version: 1,
    repo,
    base: { ref: opts.base, sha: baseSha },
    head: { ref: opts.head, sha: headSha },
    title,
    branch: branch ?? (opts.head !== "HEAD" && !/^[0-9a-f]{7,40}(\^\d*)?$/.test(opts.head) ? opts.head : undefined),
    pr: subject.match(/^Merge pull request #(\d+)/)?.[1],
    generatedAt: new Date().toISOString(),
    layers: [...LAYERS],
    areas,
    files,
    edges,
    units,
    risk,
    unattributed,
    reverted,
  };
}
