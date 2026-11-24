import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { AreaNode, FileNode } from "../../src/model.ts";
import { MAX_SYMBOLS_ON_NODE } from "./layout.ts";

export const MARK: Record<string, string> = { added: "+", modified: "~", removed: "−", unchanged: "" };
const STATUS_WORD: Record<string, string> = { added: "added", modified: "modified", removed: "removed", unchanged: "context" };

export type AreaFlowNode = Node<{ area: AreaNode }, "area">;
export type FileFlowNode = Node<{ file: FileNode; ghost: boolean; dim: boolean; selected: boolean }, "file">;

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
  const { file: f, ghost, selected } = data;
  const name = f.id.slice(f.id.lastIndexOf("/") + 1);
  const status = f.context ? "context" : f.status;
  const shown = f.symbols.slice(0, MAX_SYMBOLS_ON_NODE);
  const high = f.risk.filter((r) => r.level === "high").length;
  const warn = f.risk.filter((r) => r.level === "warn").length;
  const sub = f.route ? `route ${f.route}` : dirOf(f.id);
  return (
    <div
      className={`file file--${status}${ghost ? " file--ghost" : ""}${selected ? " is-selected" : ""}`}
      title={f.id}
      aria-label={`${f.id}, ${STATUS_WORD[f.status]}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      <div className="file__top">
        <span className={`file__status c-${f.status}`}>{MARK[f.status]}</span>
        <span className="file__name">{name}</span>
        {!f.context && (
          <span className="file__lines">
            {f.linesAdded > 0 && <span className="c-added">+{f.linesAdded}</span>} {f.linesRemoved > 0 && <span className="c-removed">−{f.linesRemoved}</span>}
          </span>
        )}
      </div>
      <div className="file__sub">{sub}</div>
      {f.risk.length > 0 && (
        <div className="file__risk">
          <span className={`dot dot--${high ? "high" : warn ? "warn" : "info"}`} />
          {f.risk.length === 1 ? f.risk[0].message : `${f.risk.length} risk flags`}
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
