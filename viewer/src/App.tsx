import { Controls, MarkerType, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WakeMap } from "../../src/model.ts";
import { FileInspector, Overview, StepInspector } from "./Inspector.tsx";
import { layout, type Placed } from "./layout.ts";
import { buildView, FOLDER_VIEW_THRESHOLD, type ImportsMode } from "./view.ts";
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
      .then((m: WakeMap) =>
        // maps written before layers existed: put everything in "Logic"
        setMap({ ...m, layers: m.layers ?? ["Routes and API", "UI", "Logic", "Data", "Tests, config and other"], areas: m.areas.map((a) => ({ ...a, layer: a.layer ?? 2 })) }),
      )
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
  const changed = map.files.filter((f) => !f.context);
  const big = changed.length > FOLDER_VIEW_THRESHOLD;
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState(0); // 0 = all changes
  const [view, setView] = useState<View>("after");
  // big changes open as folders with only changed imports; small ones open fully
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(big ? [] : map.areas.map((a) => a.id)));
  const [imports, setImports] = useState<ImportsMode>(big ? "changed" : "all");
  const [far, setFar] = useState(false);
  const flow = useReactFlow();
  const pendingFrame = useRef<string[] | null | undefined>(undefined);

  const byId = useMemo(() => new Map(map.files.map((f) => [f.id, f])), [map]);
  const unit = step > 0 ? map.units[step - 1] : null;
  const stepFiles = useMemo(() => (unit ? new Set(unit.files.filter((f) => byId.has(f))) : null), [unit, byId]);
  const vm = useMemo(() => buildView(map, { expanded, imports, stepFiles }), [map, expanded, imports, stepFiles]);

  useEffect(() => {
    let live = true;
    layout(vm).then((p) => live && setPlaced(p));
    return () => {
      live = false;
    };
  }, [vm]);

  const frame = useCallback(
    (ids: string[] | null) => {
      requestAnimationFrame(() =>
        flow.fitView({ nodes: ids ? ids.map((id) => ({ id })) : undefined, duration: 200, padding: ids ? "64px" : "32px", maxZoom: 1.1 }),
      );
    },
    [flow],
  );

  // after a re-layout, move the camera to whatever asked for it
  useEffect(() => {
    if (pendingFrame.current === undefined || !placed) return;
    const ids = pendingFrame.current;
    pendingFrame.current = undefined;
    setTimeout(() => frame(ids), 0);
  }, [placed, frame]);

  const shownAs = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of vm.areas) for (const f of a.all) m.set(f.id, a.collapsed ? `area:${a.area.id}` : f.id);
    return m;
  }, [vm]);

  const toggleArea = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    pendingFrame.current = [`area:${id}`];
  }, []);

  // in focus: the selected file and its direct neighbours
  const focus = useMemo(() => {
    if (!selected) return null;
    const s = new Set([selected]);
    for (const e of map.edges) {
      if (e.source === selected) s.add(shownAs.get(e.target) ?? e.target);
      if (e.target === selected) s.add(shownAs.get(e.source) ?? e.source);
    }
    return s;
  }, [selected, map.edges, shownAs]);

  const nodes: Node[] = useMemo(() => {
    if (!placed) return [];
    const out: Node[] = placed.bands.map((b) => ({
      id: `band:${b.layer}`,
      type: "band",
      position: { x: b.x, y: b.y },
      width: b.w,
      height: b.h,
      data: { label: map.layers[b.layer] },
      selectable: false,
      draggable: false,
      focusable: false,
      zIndex: -1,
    }));
    for (const a of vm.areas) {
      const box = placed.areas.get(a.area.id);
      if (!box) continue;
      const id = `area:${a.area.id}`;
      const steps = [...new Set(a.all.flatMap((f) => f.unitIds.map((u) => Number(u.slice(1)))))].sort((x, y) => x - y);
      out.push({
        id,
        type: a.collapsed ? "folder" : "area",
        position: { x: box.x, y: box.y },
        width: box.w,
        height: box.h,
        data: { area: a.area, files: a.all, steps, currentStep: step, onToggle: () => toggleArea(a.area.id), canCollapse: !(stepFiles && stepFiles.size <= FOLDER_VIEW_THRESHOLD) },
        selectable: false,
        draggable: false,
        focusable: false,
        className: focus && a.collapsed && !focus.has(id) ? "is-dim" : undefined,
        zIndex: a.collapsed ? 2 : 0,
      });
    }
    for (const [id, p] of placed.files) {
      const f = byId.get(id)!;
      const ghost = view === "after" ? f.status === "removed" : f.status === "added";
      out.push({
        id,
        type: "file",
        parentId: `area:${p.parent}`,
        position: { x: p.x, y: p.y },
        width: p.w,
        height: p.h,
        draggable: false,
        zIndex: 2,
        className: focus && !focus.has(id) ? "is-dim" : undefined,
        data: { file: f, ghost, selected: selected === id, steps: f.unitIds.map((u) => Number(u.slice(1))).sort((x, y) => x - y), currentStep: step },
      });
    }
    return out;
  }, [placed, vm, map.layers, byId, view, focus, selected, step, stepFiles, toggleArea]);

  const edges: Edge[] = useMemo(() => {
    if (!placed) return [];
    const list = [...vm.edges];
    // with changed-only imports, a selected file still shows all of its own imports
    if (selected && imports === "changed") {
      for (const e of map.edges) {
        if (e.status !== "unchanged" || (e.source !== selected && e.target !== selected)) continue;
        const s = shownAs.get(e.source);
        const t = shownAs.get(e.target);
        if (s && t && s !== t && !list.some((x) => x.id === `${s}->${t}`)) list.push({ id: `${s}->${t}`, source: s, target: t, status: "unchanged", count: 1 });
      }
    }
    return list.map((e) => {
      const hidden = (view === "after" && e.status === "removed") || (view === "before" && e.status === "added");
      const touchesFocus = focus ? focus.has(e.source) && focus.has(e.target) : true;
      const color = e.status === "added" ? "var(--added)" : e.status === "removed" ? "var(--removed)" : selected && touchesFocus ? "var(--foreground)" : "var(--border-strong)";
      return {
        id: e.id,
        type: "routed",
        data: { points: placed.routes.get(e.id) },
        source: e.source,
        target: e.target,
        hidden,
        label: e.count > 1 ? String(e.count) : undefined,
        className: focus && !touchesFocus ? "is-dim" : undefined,
        style: {
          stroke: color,
          strokeWidth: e.status === "unchanged" ? 1 : Math.min(1.75 + (e.count - 1) * 0.5, 4),
          strokeDasharray: e.status === "removed" ? "5 4" : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        zIndex: 1,
        focusable: false,
      };
    });
  }, [placed, vm.edges, map.edges, imports, view, focus, selected, shownAs]);

  const goStep = useCallback(
    (n: number) => {
      const next = Math.max(0, Math.min(map.units.length, n));
      setStep(next);
      setSelected(null);
      if (big) setExpanded(new Set());
      pendingFrame.current = null;
    },
    [map.units, big],
  );

  const pick = useCallback(
    (id: string | null) => {
      setSelected(id);
      if (!id) return;
      const f = byId.get(id);
      // opening a file inside a closed folder opens the folder first
      if (f && shownAs.get(id) !== id) {
        if (stepFiles && !stepFiles.has(id)) setStep(0);
        setExpanded((prev) => new Set(prev).add(f.area));
        pendingFrame.current = [id];
      } else frame([id]);
    },
    [frame, byId, shownAs, stepFiles],
  );

  const setAll = useCallback(
    (open: boolean) => {
      setExpanded(new Set(open ? map.areas.map((a) => a.id) : []));
      pendingFrame.current = null;
    },
    [map.areas],
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

  const allOpen = vm.areas.every((a) => !a.collapsed);
  const allClosed = vm.areas.every((a) => a.collapsed);

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
        <span className="topbar__range">
          {map.pr && <span>PR #{map.pr} · </span>}
          {map.branch && <span className="mono">{map.branch}</span>}
          {!map.branch && <span className="mono">{map.base.sha.slice(0, 7)} → {map.head.sha.slice(0, 7)}</span>}
        </span>
        <span className="topbar__spacer" />
        <span className="counts" aria-label="Changed files">
          {counts.added > 0 && <span><b className="c-added">{counts.added}</b> added</span>}
          {counts.modified > 0 && <span><b className="c-modified">{counts.modified}</b> modified</span>}
          {counts.removed > 0 && <span><b className="c-removed">{counts.removed}</b> removed</span>}
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
                    <span className="step__files">{u.files.map((f) => f.split("/").pop()).slice(0, 2).join(", ")}</span>
                    {u.files.length > 2 ? ` +${u.files.length - 2}` : ""}
                    {(() => {
                      const n = u.files.reduce((c, id) => c + (byId.get(id)?.risk.length ?? 0), 0);
                      return n ? ` · ${n} flag${n === 1 ? "" : "s"}` : "";
                    })()}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        {map.unattributed.length > 0 && <Unattributed files={map.unattributed} onPick={pick} />}
        {map.units.length === 0 && <div className="rail-note">No Claude Code session on this machine edited these files.</div>}
      </nav>

      <main className="canvas" aria-label="Change map">
        {placed ? (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, n) => {
            if (n.type === "file") pick(selected === n.id ? null : n.id);
            else if (n.type === "folder") toggleArea(n.id.slice(5));
          }}
          onMove={(_, vp) => setFar(vp.zoom < 0.55)}
          className={far ? "is-far" : undefined}
          onPaneClick={() => setSelected(null)}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: "32px", maxZoom: 1.1 }}
          minZoom={0.15}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Controls showInteractive={false} position="bottom-left" />
          <Panel position="top-left" className="canvas-bar">
            {!(stepFiles && stepFiles.size <= FOLDER_VIEW_THRESHOLD) && (
              <div className="toggle" role="group" aria-label="Detail">
                <button aria-pressed={allClosed} onClick={() => setAll(false)}>Folders</button>
                <button aria-pressed={allOpen} onClick={() => setAll(true)}>Files</button>
              </div>
            )}
            <div className="toggle" role="group" aria-label="Imports shown">
              <button aria-pressed={imports === "changed"} onClick={() => setImports("changed")}>Changed imports</button>
              <button aria-pressed={imports === "all"} onClick={() => setImports("all")}>All imports</button>
            </div>
            {stepFiles && <span className="canvas-bar__note">Showing step {step} only · <button className="linkish" onClick={() => goStep(0)}>Show all</button></span>}
          </Panel>
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

/** Files changed off the record, grouped by folder so 12 generated JSON files read as one line. */
function Unattributed({ files, onPick }: { files: string[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "(root)";
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  return (
    <div className="rail-note">
      Changed without a recorded agent edit
      <ul>
        {[...groups].map(([dir, fs]) =>
          fs.length === 1 ? (
            <li key={dir}>
              <button onClick={() => onPick(fs[0])}>{fs[0]}</button>
            </li>
          ) : (
            <li key={dir}>
              <button aria-expanded={open === dir} onClick={() => setOpen(open === dir ? null : dir)}>
                {dir}/ · {fs.length} files
              </button>
              {open === dir && (
                <ul className="rail-note__sub">
                  {fs.map((f) => (
                    <li key={f}>
                      <button onClick={() => onPick(f)}>{f.slice(dir.length + 1)}</button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
