import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";

export type RoutedEdge = Edge<{ points?: { x: number; y: number }[] }, "routed">;

/** Draws ELK's orthogonal route with softened corners. Falls back to a straight line. */
export function Routed({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd, label }: EdgeProps<RoutedEdge>) {
  const pts = data?.points && data.points.length >= 2 ? data.points : [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }];
  const r = 6;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const d1 = Math.min(r, Math.hypot(c.x - p.x, c.y - p.y) / 2);
    const d2 = Math.min(r, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const a = { x: c.x - Math.sign(c.x - p.x) * d1, y: c.y - Math.sign(c.y - p.y) * d1 };
    const b = { x: c.x + Math.sign(n.x - c.x) * d2, y: c.y + Math.sign(n.y - c.y) * d2 };
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  // a bundled edge between folders says how many imports it stands for, near its end
  const mid = pts[Math.max(0, pts.length - 2)];
  const lx = (mid.x + last.x) / 2;
  const ly = (mid.y + last.y) / 2;
  return (
    <>
      <BaseEdge id={id} path={d} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div className="edge-count" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }} title={`${label} imports`}>
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { routed: Routed };
