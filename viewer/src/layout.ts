import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { FileNode } from "../../src/model.ts";
import type { ViewModel } from "./view.ts";

export const FILE_W = 240;
export const FOLDER_W = 260;
export const FOLDER_H = 104;
const MAX_SYMS = 4;
export const MAX_SYMBOLS_ON_NODE = MAX_SYMS;

export function fileHeight(f: FileNode): number {
  let h = 46; // name + sub line
  if (f.risk.length) h += 18;
  const syms = Math.min(f.symbols.length, MAX_SYMS) + (f.symbols.length > MAX_SYMS ? 1 : 0);
  if (syms) h += 13 + syms * 18;
  return h;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed {
  areas: Map<string, Box>;
  files: Map<string, Box & { parent: string }>;
  /** Orthogonal routes from ELK, in absolute coordinates. */
  routes: Map<string, { x: number; y: number }[]>;
  /** One horizontal band per architecture layer present, in absolute coordinates. */
  bands: { layer: number; y: number; h: number; x: number; w: number }[];
}

const elk = new ELK();
const cache = new Map<string, Promise<Placed>>();

/**
 * Folders sit in fixed bands by architecture layer (routes, UI, logic, data, other), top to bottom.
 * Imports flow downward, so an arrow pointing up stands out.
 */
export function layout(view: ViewModel): Promise<Placed> {
  let p = cache.get(view.key);
  if (!p) {
    p = run(view);
    cache.set(view.key, p);
  }
  return p;
}

/**
 * Files with no imports between them would all land in one long row. Invisible edges between
 * file i and file i + cols stack them into a grid instead. They are never drawn.
 */
function gridEdges(view: ViewModel) {
  const out: { id: string; sources: string[]; targets: string[] }[] = [];
  for (const a of view.areas) {
    if (a.collapsed || a.files.length <= 4) continue;
    const files = [...a.files].sort((x, y) => Number(x.context) - Number(y.context) || x.id.localeCompare(y.id));
    const cols = Math.max(3, Math.ceil(Math.sqrt(files.length * 1.6)));
    for (let i = cols; i < files.length; i++) out.push({ id: `grid:${files[i - cols].id}->${files[i].id}`, sources: [files[i - cols].id], targets: [files[i].id] });
  }
  return out;
}

async function run(view: ViewModel): Promise<Placed> {
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.partitioning.activate": "true",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.spacing.nodeNode": "24",
      "elk.spacing.componentComponent": "32",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.json.edgeCoords": "ROOT",
      "elk.layered.spacing.edgeNodeBetweenLayers": "14",
      "elk.spacing.edgeEdge": "8",
    },
    children: view.areas.map((a): ElkNode =>
      a.collapsed
        ? { id: `area:${a.area.id}`, width: FOLDER_W, height: FOLDER_H, layoutOptions: { "elk.partitioning.partition": String(a.area.layer) } }
        : {
            id: `area:${a.area.id}`,
            layoutOptions: { "elk.padding": "[top=36,left=14,bottom=14,right=14]", "elk.partitioning.partition": String(a.area.layer) },
            children: [...a.files]
              .sort((x, y) => Number(x.context) - Number(y.context) || x.id.localeCompare(y.id))
              .map((f) => ({ id: f.id, width: FILE_W, height: fileHeight(f) })),
          },
    ),
    edges: [...view.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })), ...gridEdges(view)],
  };
  const out = await elk.layout(graph);
  const placed: Placed = { areas: new Map(), files: new Map(), routes: new Map(), bands: [] };
  const collect = (n: ElkNode) => {
    for (const e of (n.edges ?? []) as any[]) {
      const sec = e.sections?.[0];
      if (sec && !e.id.startsWith("grid:")) placed.routes.set(e.id, [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]);
    }
    for (const c of n.children ?? []) collect(c);
  };
  collect(out);
  let minX = Infinity;
  let maxX = -Infinity;
  for (const a of out.children ?? []) {
    const box = { x: a.x ?? 0, y: a.y ?? 0, w: a.width ?? 0, h: a.height ?? 0 };
    placed.areas.set(a.id.slice(5), box);
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.w);
    for (const f of a.children ?? []) placed.files.set(f.id, { x: f.x ?? 0, y: f.y ?? 0, w: f.width ?? FILE_W, h: f.height ?? 40, parent: a.id.slice(5) });
  }
  // bands: the vertical extent of each layer's folders, spanning the full width
  const byLayer = new Map<number, { top: number; bottom: number }>();
  for (const a of view.areas) {
    const b = placed.areas.get(a.area.id)!;
    const cur = byLayer.get(a.area.layer) ?? { top: Infinity, bottom: -Infinity };
    byLayer.set(a.area.layer, { top: Math.min(cur.top, b.y), bottom: Math.max(cur.bottom, b.y + b.h) });
  }
  const pad = 16;
  for (const [layer, { top, bottom }] of [...byLayer].sort((a, b) => a[0] - b[0]))
    placed.bands.push({ layer, y: top - pad - 22, h: bottom - top + pad * 2 + 22, x: minX - pad, w: maxX - minX + pad * 2 });
  return placed;
}
