import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { AreaNode, FileNode } from "../../src/model.ts";
import { MAX_SYMBOLS_ON_NODE } from "./layout.ts";

export const MARK: Record<string, string> = { added: "+", modified: "~", removed: "−", unchanged: "" };
const STATUS_WORD: Record<string, string> = { added: "added", modified: "modified", removed: "removed", unchanged: "context" };

export type AreaFlowNode = Node<{ area: AreaNode }, "area">;
export type FileFlowNode = Node<{ file: FileNode; ghost: boolean; selected: boolean; steps: number[]; currentStep: number }, "file">;

export function AreaView({ data }: NodeProps<AreaFlowNode>) {
  const { area } = data;
  const n = area.changed.added + area.changed.modified + area.changed.removed;
  return (
    <div className="area">
      <div className="area__label">
        <span className="mono">{area.label}</span> · {n ? `${n} of ${area.totalFiles} files changed` : `${area.totalFiles} files, unchanged`}
      </div>
    </div>
  );
}

function dirOf(id: string) {
  const i = id.lastIndexOf("/");
  return i < 0 ? "" : id.slice(0, i);
}

export function FileView({ data }: NodeProps<FileFlowNode>) {
  const { file: f, ghost, selected, steps, currentStep } = data;
  const name = f.id.slice(f.id.lastIndexOf("/") + 1);
  const status = f.context ? "context" : f.status;
  const shown = f.symbols.slice(0, MAX_SYMBOLS_ON_NODE);
  const order = { high: 0, warn: 1, info: 2 };
  const top = [...f.risk].sort((a, b) => order[a.level] - order[b.level])[0];
  const sub = f.route ? `route ${f.route}` : dirOf(f.id);
  return (
    <div
      className={`file file--${status}${ghost ? " file--ghost" : ""}${selected ? " is-selected" : ""}`}
      title={f.id}
      aria-label={`${f.id}, ${STATUS_WORD[f.status]}${f.risk.length ? `, ${f.risk.length} risk flags` : ""}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      <div className="file__top">
        <span className={`file__status c-${f.status}`}>{MARK[f.status]}</span>
        <span className="file__name">{name}</span>
        {steps.length > 0 && (
          <span className="file__steps" aria-label={`Changed in step ${steps.join(", ")}`}>
            {steps.map((n, i) => (
              <span key={n} className={n === currentStep ? "is-current" : undefined}>
                {i > 0 ? " · " : ""}
                {n}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="file__sub">
        <span className="file__dir">{sub}</span>
        {!f.context && (
          <span className="file__lines">
            {f.linesAdded > 0 && <span className="c-added">+{f.linesAdded}</span>}
            {f.linesAdded > 0 && f.linesRemoved > 0 && " "}
            {f.linesRemoved > 0 && <span className="c-removed">−{f.linesRemoved}</span>}
          </span>
        )}
      </div>
      {top && (
        <div className={`file__risk risk--${top.level}`}>
          <span className={`dot dot--${top.level}`} />
          <span className="file__risk-text">{top.message}</span>
          {f.risk.length > 1 && <span className="file__risk-more">+{f.risk.length - 1}</span>}
        </div>
      )}
      {shown.length > 0 && (
        <ul className="syms">
          {shown.map((s) => (
            <li key={`${s.name}:${s.lines[0]}`} className="sym">
              <span className={`sym__mark c-${s.status}`}>{MARK[s.status]}</span>
              <span className="sym__name">{s.name}</span>
              <span className="sym__kind">{s.kind}</span>
              {s.signatureChanged && s.status === "modified" && s.exported && <span className="sym__sig">signature</span>}
            </li>
          ))}
          {f.symbols.length > shown.length && <li className="syms__more">{f.symbols.length - shown.length} more</li>}
        </ul>
      )}
    </div>
  );
}

export const nodeTypes = { area: AreaView, file: FileView };
