import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WakeMap } from "../../src/model.ts";
import { FileInspector, Overview, StepInspector } from "./Inspector.tsx";
import { layout, type Placed } from "./layout.ts";
import { edgeTypes } from "./edges.tsx";
import { nodeTypes } from "./nodes.tsx";

type View = "after" | "before";
const BAND_TEXT = { low: "Low risk", review: "Needs a review", expert: "Needs an expert" } as const;

export function App() {
  const [map, setMap] = useState<WakeMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/wakemap.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setMap)
      .catch((e) => setError(String(e)));
  }, []);
  if (error)
    return (
      <div className="state">
        <div>
          <h1>No change map to show</h1>
          <p>
            Run <code>wakemap analyze --repo &lt;path&gt; --base &lt;ref&gt;</code>, then <code>wakemap show</code>.
          </p>
        </div>
      </div>
    );
  if (!map) return <div className="state">Loading the change map…</div>;
  return (
    <ReactFlowProvider>
      <Shell map={map} />
    </ReactFlowProvider>
  );
}

function Shell({ map }: { map: WakeMap }) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState(0); // 0 = all changes
  const [view, setView] = useState<View>("after");
  const flow = useReactFlow();

  useEffect(() => {
    layout(map).then(setPlaced);
  }, [map]);

  const byId = useMemo(() => new Map(map.files.map((f) => [f.id, f])), [map]);
  const changed = map.files.filter((f) => !f.context);
  const unit = step > 0 ? map.units[step - 1] : null;

  // what is in focus: a story step's files, or the selected file and its neighbours
  const focus = useMemo(() => {
    if (selected) {
      const s = new Set([selected]);
      for (const e of map.edges) {
        if (e.source === selected) s.add(e.target);
        if (e.target === selected) s.add(e.source);
      }
      return s;
    }
    if (unit) return new Set(unit.files);
    return null;
  }, [selected, unit, map.edges]);

  const nodes: Node[] = useMemo(() => {
    if (!placed) return [];
    const areaNodes: Node[] = placed.areas.map((a) => ({
      id: `area:${a.id}`,
      type: "area",
      position: { x: a.x, y: a.y },
      width: a.w,
      height: a.h,
      data: { area: map.areas.find((x) => x.id === a.id)! },
      selectable: false,
      draggable: false,
      focusable: false,
      zIndex: 0,
    }));
    const fileNodes: Node[] = [];
    for (const [id, p] of placed.files) {
      const f = byId.get(id)!;
      const ghost = view === "after" ? f.status === "removed" : f.status === "added";
      fileNodes.push({
        id,
        type: "file",
        parentId: `area:${p.parent}`,
        position: { x: p.x, y: p.y },
        width: p.w,
        height: p.h,
        draggable: false,
        zIndex: 2,
        className: focus && !focus.has(id) ? "is-dim" : undefined,
        data: { file: f, ghost, selected: selected === id },
      });
    }
    return [...areaNodes, ...fileNodes];
  }, [placed, map, byId, view, focus, selected]);

  const edges: Edge[] = useMemo(
    () =>
      map.edges.map((e) => {
        const hidden = (view === "after" && e.status === "removed") || (view === "before" && e.status === "added");
        const touchesFocus = focus ? focus.has(e.source) && focus.has(e.target) : true;
        const color = e.status === "added" ? "var(--added)" : e.status === "removed" ? "var(--removed)" : selected && touchesFocus ? "var(--foreground)" : "var(--border-strong)";
        return {
          id: e.id,
          type: "routed",
          data: { points: placed?.routes.get(e.id) },
          source: e.source,
          target: e.target,
          hidden,
          animated: e.status === "added" && view === "after",
          className: focus && !touchesFocus ? "is-dim" : undefined,
          style: {
            stroke: color,
            strokeWidth: e.status === "unchanged" ? 1.25 : 2,
            strokeDasharray: e.status === "removed" ? "5 4" : undefined,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
          zIndex: 1,
          focusable: false,
        };
      }),
    [map.edges, view, focus, selected, placed],
  );

  const frame = useCallback(
    (ids: string[] | null) => {
      requestAnimationFrame(() =>
        flow.fitView({ nodes: ids ? ids.map((id) => ({ id })) : undefined, duration: 200, padding: ids ? 0.35 : 0.08, maxZoom: 1.1 }),
      );
    },
    [flow],
  );

  const goStep = useCallback(
    (n: number) => {
      const next = Math.max(0, Math.min(map.units.length, n));
      setStep(next);
      setSelected(null);
      frame(next > 0 ? map.units[next - 1].files.filter((f) => byId.has(f)) : null);
    },
    [map.units, byId, frame],
  );

  const pick = useCallback(
    (id: string | null) => {
      setSelected(id);
      if (id) frame([id]);
    },
    [frame],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "j" || e.key === "ArrowDown") (e.preventDefault(), goStep(step + 1));
      else if (e.key === "k" || e.key === "ArrowUp") (e.preventDefault(), goStep(step - 1));
      else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goStep, step]);

  const counts = {
    added: changed.filter((f) => f.status === "added").length,
    modified: changed.filter((f) => f.status === "modified").length,
    removed: changed.filter((f) => f.status === "removed").length,
  };
  const file = selected ? byId.get(selected) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <span className="wordmark">wakemap</span>
        <span className="topbar__title" title={map.title}>{map.title}</span>
        <span className="topbar__range mono">
          {map.base.sha.slice(0, 7)} → {map.head.sha.slice(0, 7)}
        </span>
        <span className="topbar__spacer" />
        <span className="counts" aria-label="Changed files">
          <span><b className="c-added">{counts.added}</b> added</span>
          <span><b className="c-modified">{counts.modified}</b> modified</span>
          <span><b className="c-removed">{counts.removed}</b> removed</span>
        </span>
        <div className="toggle" role="group" aria-label="Show the code">
          <button aria-pressed={view === "before"} onClick={() => setView("before")}>Before</button>
          <button aria-pressed={view === "after"} onClick={() => setView("after")}>After</button>
        </div>
        <span className="band">
          <span className={`dot dot--${map.risk.band}`} />
          {BAND_TEXT[map.risk.band]}
        </span>
      </header>

      <nav className="story" aria-label="Agent prompts in order">
        <div className="rail-head">
          <span>What the agent was asked</span>
          <span className="kbd">j / k</span>
        </div>
        <ol className="steps">
          <li>
            <button className="step step--all" aria-current={step === 0} onClick={() => goStep(0)}>
              <span className="step__n">·</span>
              <span>
                <span className="step__prompt">All changes</span>
                <span className="step__meta">{changed.length} files across {map.areas.filter((a) => a.changed.added + a.changed.modified + a.changed.removed).length} areas</span>
              </span>
            </button>
          </li>
          {map.units.map((u) => (
            <li key={u.id}>
              <button className="step" aria-current={step === u.order} onClick={() => goStep(u.order)}>
                <span className="step__n">{u.order}</span>
                <span>
                  <span className="step__prompt">{u.prompt}</span>
                  <span className="step__meta">
                    {u.files.length} file{u.files.length === 1 ? "" : "s"} · {new Date(u.promptAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        {map.unattributed.length > 0 && (
          <div className="rail-note">
            Changed without a recorded agent edit
            <ul>
              {map.unattributed.map((f) => (
                <li key={f}>
                  <button onClick={() => pick(f)}>{f}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {map.units.length === 0 && <div className="rail-note">No Claude Code session on this machine edited these files.</div>}
      </nav>

      <main className="canvas" aria-label="Change map">
        {placed ? (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, n) => n.type === "file" && pick(selected === n.id ? null : n.id)}
          onPaneClick={() => setSelected(null)}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.08, maxZoom: 1.1 }}
          minZoom={0.15}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
          <Controls showInteractive={false} position="bottom-left" />
        </ReactFlow>
        ) : (
          <div className="state">Laying out the map…</div>
        )}
      </main>

      <aside className="inspector" aria-label="Details">
        {file ? (
          <FileInspector map={map} file={file} onPick={pick} />
        ) : unit ? (
          <StepInspector map={map} unit={unit} onPick={pick} />
        ) : (
          <Overview map={map} onPick={pick} />
        )}
      </aside>
    </div>
  );
}
