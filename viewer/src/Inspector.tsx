import { useState } from "react";
import type { ChangeUnit, FileNode, RiskFlag, WakeMap } from "../../src/model.ts";
import { MARK } from "./nodes.tsx";

const BAND_TEXT = { low: "Low risk", review: "Needs a review", expert: "Needs an expert" } as const;
const BAND_HINT = {
  low: "Nothing here matched a risk rule.",
  review: "Some changes touch shared code or happened outside the agent's recorded edits.",
  expert: "Touches sensitive code or weakens tests. Have an owner look.",
} as const;

function time(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Flags({ flags, onPick }: { flags: RiskFlag[]; onPick?: (file: string) => void }) {
  if (!flags.length) return <p className="sec__empty">No risk rules matched.</p>;
  const order = { high: 0, warn: 1, info: 2 };
  return (
    <ul className="flags">
      {[...flags].sort((a, b) => order[a.level] - order[b.level]).map((f, i) => (
        <li key={i} className="flag">
          <span className={`dot dot--${f.level}`} aria-label={f.level} />
          <div>
            <div>{f.message}</div>
            {onPick && f.file && (
              <button className="flag__file" onClick={() => onPick(f.file!)}>
                {f.file}
                {f.line ? `:${f.line}` : ""}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Why({ unit, file }: { unit: ChangeUnit; file?: string }) {
  const [showContext, setShowContext] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // the agent's words about this file first, then the rest of what it said for this prompt
  const rationale = file ? [...unit.rationale.filter((r) => r.file === file), ...unit.rationale.filter((r) => r.file !== file)] : unit.rationale;
  const shown = expanded ? rationale : rationale.slice(0, 2);
  return (
    <div className="why__unit">
      <div className="who">
        <span>You asked · step {unit.order}</span>
        <time dateTime={unit.promptAt}>{time(unit.promptAt)}</time>
      </div>
      <p className="quote quote--user quote--clamp">{unit.prompt}</p>
      {unit.promptContext && (
        <>
          <button className="linkish" aria-expanded={showContext} onClick={() => setShowContext((v) => !v)}>
            {showContext ? "Hide what the agent proposed" : "Show what the agent proposed before this"}
          </button>
          {showContext && <div className="context-box">{unit.promptContext}</div>}
        </>
      )}
      {shown.map((r) => (
        <div key={r.uuid} className="why__said">
          <div className="who">
            <span>Agent said{r.file && r.file !== file ? ` (editing ${r.file.split("/").pop()})` : ""}</span>
            <time dateTime={r.at}>{time(r.at)}</time>
          </div>
          <p className="quote quote--agent">{r.text}</p>
        </div>
      ))}
      {rationale.length > 2 && (
        <button className="linkish" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : `Show ${rationale.length - 2} more`}
        </button>
      )}
      {rationale.length === 0 && <p className="sec__empty">The agent made this edit without explaining it.</p>}
    </div>
  );
}

function Diff({ file }: { file: FileNode }) {
  return (
    <div className="diff" role="region" aria-label={`Diff of ${file.id}`}>
      {file.hunks.map((h, i) => (
        <div key={i} className="diff__hunk">
          <div className="diff__head">{h.header}</div>
          {h.lines.map((l, j) => (
            <div key={j} className={`diff__line${l[0] === "+" ? " diff__line--add" : l[0] === "-" ? " diff__line--del" : ""}`}>
              {l}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function FileInspector({ map, file, onPick }: { map: WakeMap; file: FileNode; onPick: (id: string) => void }) {
  const [showDiff, setShowDiff] = useState(false);
  const units = map.units.filter((u) => file.unitIds.includes(u.id));
  const importers = map.edges.filter((e) => e.target === file.id && e.status !== "removed").map((e) => e.source);
  const statusWord = file.context ? "Unchanged, shown for context" : file.status[0].toUpperCase() + file.status.slice(1);
  return (
    <div className="ins" key={file.id}>
      <div>
        <div className="ins__path">{file.id}</div>
        <div className="ins__facts">
          <span className={`c-${file.status}`}>{statusWord}</span>
          {!file.context && (
            <span className="mono">
              {file.linesAdded > 0 && <span className="c-added">+{file.linesAdded}</span>} {file.linesRemoved > 0 && <span className="c-removed">−{file.linesRemoved}</span>}
            </span>
          )}
          {file.route && <span>Route {file.route}</span>}
          <span>
            Used by {file.importedBy} file{file.importedBy === 1 ? "" : "s"}
            {file.blastRadius > file.importedBy ? `, ${file.blastRadius} indirectly` : ""}
          </span>
        </div>
      </div>

      {!file.context && (
        <section className="sec">
          <h2 className="sec__title">Why it changed</h2>
          <div className="why">
            {units.length ? units.map((u) => <Why key={u.id} unit={u} file={file.id} />) : (
              <p className="sec__empty">No agent edit in the recorded sessions produced this change. It was made by hand, by a shell command we could not trace, or in another session.</p>
            )}
          </div>
        </section>
      )}

      {file.risk.length > 0 && (
        <section className="sec">
          <h2 className="sec__title">Risk</h2>
          <Flags flags={file.risk} />
        </section>
      )}

      {file.symbols.length > 0 && (
        <section className="sec">
          <h2 className="sec__title">What changed inside</h2>
          <ul className="symlist">
            {file.symbols.map((s) => (
              <li key={`${s.name}:${s.lines[0]}`}>
                <span className={`sym__mark c-${s.status}`}>{MARK[s.status]}</span>
                <span className="sym__name mono">{s.name}</span>
                <span className="sym__kind">
                  {s.exported ? "exported " : ""}
                  {s.kind}, line {s.lines[0]}
                </span>
                {s.signatureChanged && s.status === "modified" && s.exported && <span className="sym__sig">signature changed</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {importers.length > 0 && (
        <section className="sec">
          <h2 className="sec__title">Imported by (on this map)</h2>
          <ul className="flags">
            {importers.map((i) => (
              <li key={i}>
                <button className="flag__file" onClick={() => onPick(i)}>{i}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {file.hunks.length > 0 && (
        <section className="sec">
          <button className="linkish" aria-expanded={showDiff} onClick={() => setShowDiff((v) => !v)}>
            {showDiff ? "Hide the diff" : "Show the diff"}
          </button>
          {showDiff && <Diff file={file} />}
        </section>
      )}
    </div>
  );
}

export function Overview({ map, onPick }: { map: WakeMap; onPick: (id: string) => void }) {
  return (
    <div className="ins">
      <div>
        <div className="band">
          <span className={`dot dot--${map.risk.band}`} />
          <span className="ins__path" style={{ fontFamily: "var(--font-sans)" }}>{BAND_TEXT[map.risk.band]}</span>
        </div>
        <p className="overview__lead">{BAND_HINT[map.risk.band]}</p>
      </div>
      <section className="sec">
        <h2 className="sec__title">Risk flags</h2>
        <Flags flags={map.risk.flags} onPick={onPick} />
      </section>
      <section className="sec">
        <h2 className="sec__title">Reading the map</h2>
        <div className="legend">
          <span className="legend__swatch file--added" style={{ border: "2px solid var(--added)" }} />
          <span>Added file</span>
          <span className="legend__swatch" style={{ border: "1px solid var(--modified)" }} />
          <span>Modified file</span>
          <span className="legend__swatch" style={{ border: "1px dashed var(--removed)", background: "var(--removed-soft)" }} />
          <span>Removed file</span>
          <span className="legend__swatch" style={{ border: "1px dashed var(--border-strong)", background: "transparent" }} />
          <span>Unchanged neighbour</span>
          <span className="legend__edge" />
          <span>New import</span>
          <span className="legend__edge" style={{ borderTop: "1px dashed var(--removed)" }} />
          <span>Removed import</span>
        </div>
        <p className="sec__empty">Arrows point from a file down to what it imports. Grey boxes are top-level folders.</p>
      </section>
    </div>
  );
}

export function StepInspector({ map, unit, onPick }: { map: WakeMap; unit: ChangeUnit; onPick: (id: string) => void }) {
  const files = unit.files.map((id) => map.files.find((f) => f.id === id)).filter((f): f is FileNode => !!f);
  const flags = files.flatMap((f) => f.risk);
  return (
    <div className="ins" key={unit.id}>
      <section className="sec">
        <h2 className="sec__title">Step {unit.order} of {map.units.length}</h2>
        <div className="why">
          <Why unit={unit} />
        </div>
      </section>
      <section className="sec">
        <h2 className="sec__title">Files this step changed</h2>
        <ul className="symlist">
          {files.map((f) => (
            <li key={f.id}>
              <span className={`sym__mark c-${f.status}`}>{MARK[f.status]}</span>
              <button className="flag__file" style={{ color: "var(--foreground)" }} onClick={() => onPick(f.id)}>{f.id}</button>
            </li>
          ))}
        </ul>
      </section>
      {flags.length > 0 && (
        <section className="sec">
          <h2 className="sec__title">Risk in these files</h2>
          <Flags flags={flags} onPick={onPick} />
        </section>
      )}
    </div>
  );
}
