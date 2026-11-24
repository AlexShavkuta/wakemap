import type { AreaNode, ChangeStatus, FileNode, WakeMap } from "../../src/model.ts";

export type ImportsMode = "changed" | "all";

export interface ViewArea {
  area: AreaNode;
  collapsed: boolean;
  files: FileNode[]; // files shown inside (empty when collapsed)
  all: FileNode[]; // every file of the area on the map
}

export interface ViewEdge {
  id: string;
  source: string; // file id or "area:<id>"
  target: string;
  status: ChangeStatus;
  count: number;
}

export interface ViewModel {
  areas: ViewArea[];
  edges: ViewEdge[];
  /** Stable key of the structure, used to cache layouts. */
  key: string;
}

/** Folder view is the default once a change is too big to read file by file. */
export const FOLDER_VIEW_THRESHOLD = 10;

export function buildView(map: WakeMap, opts: { expanded: Set<string>; imports: ImportsMode; stepFiles: Set<string> | null }): ViewModel {
  const inStep = (f: FileNode) => !opts.stepFiles || opts.stepFiles.has(f.id);
  const areas: ViewArea[] = [];
  for (const area of map.areas) {
    const all = map.files.filter((f) => f.area === area.id && inStep(f));
    if (!all.length) continue;
    // a small story step opens the folders it touched; a big one starts as folders like the full view
    const smallStep = !!opts.stepFiles && opts.stepFiles.size <= FOLDER_VIEW_THRESHOLD;
    const collapsed = !smallStep && !opts.expanded.has(area.id);
    areas.push({ area, collapsed, files: collapsed ? [] : all, all });
  }
  const shownAs = new Map<string, string>();
  for (const a of areas) for (const f of a.all) shownAs.set(f.id, a.collapsed ? `area:${a.area.id}` : f.id);

  const agg = new Map<string, ViewEdge>();
  for (const e of map.edges) {
    if (opts.imports === "changed" && e.status === "unchanged") continue;
    const s = shownAs.get(e.source);
    const t = shownAs.get(e.target);
    if (!s || !t || s === t) continue;
    const id = `${s}->${t}`;
    const prev = agg.get(id);
    if (!prev) agg.set(id, { id, source: s, target: t, status: e.status, count: 1 });
    else {
      prev.count++;
      // added wins over removed wins over unchanged: show the most important change on a bundled edge
      if (e.status === "added" || (e.status === "removed" && prev.status === "unchanged")) prev.status = e.status;
    }
  }
  const edges = [...agg.values()];
  const key = [
    areas.map((a) => `${a.area.id}${a.collapsed ? "-" : "+"}${a.files.map((f) => f.id).join(",")}`).join("|"),
    edges.map((e) => e.id).join("|"),
  ].join("#");
  return { areas, edges, key };
}

/** Worst risk level among files, for folder badges. */
export function worstFlag(files: FileNode[]) {
  const order = { high: 0, warn: 1, info: 2 } as const;
  const flags = files.flatMap((f) => f.risk).sort((a, b) => order[a.level] - order[b.level]);
  return { top: flags[0], count: flags.length };
}
