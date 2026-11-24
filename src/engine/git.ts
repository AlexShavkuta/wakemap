import { execFileSync } from "node:child_process";

export class Git {
  constructor(readonly repo: string) {}

  run(args: string[]): string {
    return execFileSync("git", ["-C", this.repo, ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  }

  sha(ref: string): string {
    return this.run(["rev-parse", ref]).trim();
  }

  listFiles(sha: string): string[] {
    return this.run(["ls-tree", "-r", "--name-only", sha]).split("\n").filter(Boolean);
  }

  /** Read many files at one revision with a single `git cat-file --batch`. */
  readFiles(sha: string, paths: string[]): Map<string, string> {
    const out = new Map<string, string>();
    if (paths.length === 0) return out;
    const buf = execFileSync("git", ["-C", this.repo, "cat-file", "--batch"], {
      input: paths.map((p) => `${sha}:${p}`).join("\n") + "\n",
      maxBuffer: 1024 * 1024 * 1024,
    });
    let pos = 0;
    for (const p of paths) {
      const nl = buf.indexOf(10, pos);
      const header = buf.subarray(pos, nl).toString("utf8");
      pos = nl + 1;
      if (header.endsWith("missing")) continue;
      const size = Number(header.split(" ")[2]);
      out.set(p, buf.subarray(pos, pos + size).toString("utf8"));
      pos += size + 1;
    }
    return out;
  }

  /** Changed paths with rename detection. */
  nameStatus(base: string, head: string): { status: string; path: string; oldPath?: string }[] {
    return this.run(["diff", "--name-status", "-M", base, head])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, a, b] = line.split("\t");
        return status.startsWith("R") ? { status: "R", path: b, oldPath: a } : { status, path: a };
      });
  }

  numstat(base: string, head: string): Map<string, [number, number]> {
    const out = new Map<string, [number, number]>();
    for (const line of this.run(["diff", "--numstat", "-M", base, head]).split("\n")) {
      if (!line) continue;
      const [a, r, ...rest] = line.split("\t");
      let path = rest.join("\t");
      // "src/{a => b}/x.ts" or "a => b" rename syntax: keep the new path
      path = path.replace(/\{[^}]* => ([^}]*)\}/, "$1").replace(/^.* => /, "").replace("//", "/");
      out.set(path, [Number(a) || 0, Number(r) || 0]);
    }
    return out;
  }

  /** Unified diff with zero context, parsed per file. */
  hunks(base: string, head: string, context = 2): Map<string, { header: string; lines: string[]; newStart: number; newLen: number; oldStart: number; oldLen: number }[]> {
    const raw = this.run(["diff", `-U${context}`, "-M", "--no-color", base, head]);
    const out = new Map<string, { header: string; lines: string[]; newStart: number; newLen: number; oldStart: number; oldLen: number }[]>();
    let file: string | null = null;
    let current: { header: string; lines: string[]; newStart: number; newLen: number; oldStart: number; oldLen: number } | null = null;
    for (const line of raw.split("\n")) {
      if (line.startsWith("diff --git")) {
        file = null;
        current = null;
        continue;
      }
      if (line.startsWith("--- ") && !current) {
        const p = line.slice(4);
        file = p === "/dev/null" ? null : p.replace(/^a\//, "");
        continue;
      }
      if (line.startsWith("+++ ") && !current) {
        const p = line.slice(4);
        if (p !== "/dev/null") file = p.replace(/^b\//, "");
        if (file && !out.has(file)) out.set(file, []);
        continue;
      }
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m && file) {
        current = {
          header: line,
          lines: [],
          oldStart: Number(m[1]),
          oldLen: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newLen: m[4] === undefined ? 1 : Number(m[4]),
        };
        out.get(file)!.push(current);
        continue;
      }
      if (current && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) current.lines.push(line);
    }
    return out;
  }
}
