import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { FileNode, WakeMap } from "../../src/model.ts";

export const FILE_W = 240;
const MAX_SYMS = 4;

export function fileHeight(f: FileNode): number {
  let h = 46; // name + sub line
  if (f.risk.length) h += 18;
  const syms = Math.min(f.symbols.length, MAX_SYMS) + (f.symbols.length > MAX_SYMS ? 1 : 0);
  if (syms) h += 13 + syms * 18;
  return h;
}

export const MAX_SYMBOLS_ON_NODE = MAX_SYMS;

export interface Placed {
  areas: { id: string; x: number; y: number; w: number; h: number }[];
  files: Map<string, { x: number; y: number; w: number; h: number; parent: string }>;
  /** Orthogonal routes from ELK, in absolute coordinates. */
  routes: Map<string, { x: number; y: number }[]>;
}

const elk = new ELK();

/**
 * One layout for both "before" and "after", so nothing moves when toggling.
 * Imports flow top to bottom: an importer sits above what it imports.
 */
export async function layout(map: WakeMap): Promise<Placed> {
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "40",
      "elk.spacing.nodeNode": "20",
      "elk.spacing.componentComponent": "40",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.json.edgeCoords": "ROOT",
      "elk.layered.spacing.edgeNodeBetweenLayers": "14",
      "elk.spacing.edgeEdge": "8",
    },
    children: map.areas.map((a) => ({
      id: `area:${a.id}`,
      layoutOptions: { "elk.padding": "[top=36,left=14,bottom=14,right=14]" },
      children: map.files
        .filter((f) => f.area === a.id)
        // changed files first, so they sit together near the top of each area
        .sort((x, y) => Number(x.context) - Number(y.context) || x.id.localeCompare(y.id))
        .map((f) => ({ id: f.id, width: FILE_W, height: fileHeight(f) })),
    })),
    edges: map.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const out = await elk.layout(graph);
  const placed: Placed = { areas: [], files: new Map(), routes: new Map() };
  // ELK may move an edge into the area that contains both ends; walk the whole tree
  const collect = (n: ElkNode) => {
    for (const e of (n.edges ?? []) as any[]) {
      const sec = e.sections?.[0];
      if (sec) placed.routes.set(e.id, [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]);
    }
    for (const c of n.children ?? []) collect(c);
  };
  collect(out);
  for (const a of out.children ?? []) {
    placed.areas.push({ id: a.id.slice(5), x: a.x ?? 0, y: a.y ?? 0, w: a.width ?? 0, h: a.height ?? 0 });
    for (const f of a.children ?? []) placed.files.set(f.id, { x: f.x ?? 0, y: f.y ?? 0, w: f.width ?? FILE_W, h: f.height ?? 40, parent: a.id.slice(5) });
  }
  return placed;
}
