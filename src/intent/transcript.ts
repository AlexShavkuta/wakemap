import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentEdit {
  transcript: string;
  uuid: string;
  toolUseId: string;
  at: string;
  /** Absolute path the agent wrote to. */
  path: string;
  tool: "Edit" | "Write" | "MultiEdit" | "Bash";
  /** Shell edits only: the directory the command ran in. The file is resolved later from the command text. */
  shellRoot?: string;
  /** Text the agent wrote (new_string / content). */
  written: string[];
  promptKey: string;
  /** The agent's last words before this edit, verbatim. */
  narration?: { text: string; uuid: string; at: string };
}

export interface Prompt {
  key: string;
  transcript: string;
  uuid: string;
  at: string;
  text: string;
  /** What the agent said just before this prompt, so "do it" or "option A" can be read in context. */
  context?: string;
}

/** Commands that write files: scripted replaces, sed -i, redirects, tee, heredocs. */
const SHELL_WRITE = /(\.write\(|write_text|open\([^)]*["'][wa]\+?["']|sed\s+-i|perl\s+-p?i|\btee\b|>\s*[\w./-]+\.\w+|cat\s*>|replaceAll|writeFileSync)/;

export interface SessionLog {
  prompts: Map<string, Prompt>;
  edits: AgentEdit[];
}

/** Text the user typed, with harness-injected blocks removed. Empty if the message is not a real prompt. */
function promptText(content: unknown): string {
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n")
        : "";
  if (Array.isArray(content) && content.some((b) => b?.type === "tool_result")) return "";
  const cleaned = raw
    .replace(/<([a-z][a-z0-9_-]*)\b[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .trim();
  if (!cleaned || cleaned.startsWith("Caveat:") || cleaned.startsWith("[Request interrupted")) return "";
  return cleaned;
}

export function readTranscript(file: string, roots: string[]): SessionLog {
  const prompts = new Map<string, Prompt>();
  const edits: AgentEdit[] = [];
  let promptKey = "";
  let narration: AgentEdit["narration"];
  let lastSaid = "";
  const inRoots = (p: string) => roots.some((r) => p.startsWith(r.endsWith("/") ? r : r + "/"));

  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain) continue;
    if (o.type === "user" && !o.isMeta) {
      const text = promptText(o.message?.content);
      if (text) {
        promptKey = `${file}#${o.uuid}`;
        prompts.set(promptKey, { key: promptKey, transcript: file, uuid: o.uuid, at: o.timestamp, text, context: lastSaid || undefined });
        narration = undefined;
      }
      continue;
    }
    if (o.type !== "assistant") continue;
    for (const b of o.message?.content ?? []) {
      if (b?.type === "text" && b.text?.trim()) {
        narration = { text: b.text.trim(), uuid: o.uuid, at: o.timestamp };
        lastSaid = b.text.trim();
      } else if (b?.type === "tool_use" && (b.name === "Edit" || b.name === "Write" || b.name === "MultiEdit")) {
        const path: string = b.input?.file_path ?? "";
        if (!inRoots(path)) continue;
        const written =
          b.name === "Write"
            ? [b.input.content ?? ""]
            : b.name === "MultiEdit"
              ? (b.input.edits ?? []).map((e: any) => e.new_string ?? "")
              : [b.input.new_string ?? ""];
        edits.push({ transcript: file, uuid: o.uuid, toolUseId: b.id, at: o.timestamp, path, tool: b.name, written, promptKey, narration });
      } else if (b?.type === "tool_use" && b.name === "Bash") {
        const cmd: string = b.input?.command ?? "";
        if (!SHELL_WRITE.test(cmd)) continue;
        const cd = cmd.match(/^\s*cd\s+("?)([^"&;\n]+)\1\s*(&&|;|\n)/);
        const dir = (cd ? cd[2].trim() : o.cwd ?? "").replace(/\/$/, "");
        const root = roots.find((r) => dir === r || dir.startsWith(r + "/"));
        if (!root) continue;
        edits.push({ transcript: file, uuid: o.uuid, toolUseId: b.id, at: o.timestamp, path: dir + "/", tool: "Bash", shellRoot: dir, written: [cmd], promptKey, narration });
      }
    }
  }
  return { prompts, edits };
}

/** All Claude Code transcripts on this machine that edited files under one of `roots`. */
export function findTranscripts(roots: string[]): string[] {
  const dir = join(homedir(), ".claude", "projects");
  const out: string[] = [];
  let projects: string[] = [];
  try {
    projects = readdirSync(dir);
  } catch {
    return out;
  }
  for (const p of projects) {
    const pdir = join(dir, p);
    let entries: string[] = [];
    try {
      if (!statSync(pdir).isDirectory()) continue;
      entries = readdirSync(pdir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.endsWith(".jsonl")) continue;
      const f = join(pdir, e);
      const text = readFileSync(f, "utf8");
      if (roots.some((r) => text.includes(`"file_path":"${r}/`) || text.includes(`"cwd":"${r}"`) || text.includes(`cd ${r}`))) out.push(f);
    }
  }
  return out;
}

export function mergeLogs(logs: SessionLog[]): SessionLog {
  const prompts = new Map<string, Prompt>();
  const edits: AgentEdit[] = [];
  for (const l of logs) {
    for (const [k, v] of l.prompts) prompts.set(k, v);
    edits.push(...l.edits);
  }
  edits.sort((a, b) => a.at.localeCompare(b.at));
  return { prompts, edits };
}
