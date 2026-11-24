import { posix } from "node:path";
import ts from "typescript";
import { Git } from "./git.ts";
import { isCodeFile, parseFile, type ParsedFile } from "./parse.ts";

export interface RepoGraph {
  sha: string;
  files: Set<string>;
  parsed: Map<string, ParsedFile>;
  /** file -> imported repo files */
  imports: Map<string, Set<string>>;
  /** file -> files importing it */
  importers: Map<string, Set<string>>;
}

const IGNORED = /(^|\/)(node_modules|\.next|dist|build|out|coverage|\.wrangler|\.open-next|ios\/App\/App\/public)\//;
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

/** Reads tsconfig "paths" aliases such as "@/*": ["./src/*"]. */
function readAliases(tsconfig: string | undefined): [string, string][] {
  if (!tsconfig) return [];
  try {
    // tsconfig allows comments and trailing commas; let TypeScript parse it
    const json = ts.parseConfigFileTextToJson("tsconfig.json", tsconfig).config ?? {};
    const paths: Record<string, string[]> = json.compilerOptions?.paths ?? {};
    const baseUrl: string = json.compilerOptions?.baseUrl ?? ".";
    return Object.entries(paths).map(([k, v]) => [k.replace(/\*$/, ""), posix.normalize(posix.join(baseUrl, v[0].replace(/\*$/, ""))).replace(/^\.\//, "")]);
  } catch {
    return [];
  }
}

export function resolveImport(from: string, spec: string, files: Set<string>, aliases: [string, string][]): string | undefined {
  let base: string | undefined;
  if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else {
    for (const [prefix, target] of aliases) {
      if (spec.startsWith(prefix)) {
        base = posix.normalize(target + (target.endsWith("/") || target === "" ? "" : "/") + spec.slice(prefix.length));
        break;
      }
    }
  }
  if (base === undefined) return undefined; // package import
  // "./x.js" written for a .ts file
  const candidates = [base, base.replace(/\.(m|c)?js$/, "")];
  for (const c of candidates) for (const ext of EXTS) if (files.has(c + ext)) return c + ext;
  return undefined;
}

export function buildGraph(git: Git, sha: string): RepoGraph {
  const all = git.listFiles(sha).filter((f) => !IGNORED.test(f));
  const files = new Set(all);
  const code = all.filter(isCodeFile);
  const contents = git.readFiles(sha, [...code, "tsconfig.json"]);
  const aliases = readAliases(contents.get("tsconfig.json"));

  const parsed = new Map<string, ParsedFile>();
  const imports = new Map<string, Set<string>>();
  const importers = new Map<string, Set<string>>();
  for (const f of code) {
    const text = contents.get(f);
    if (text === undefined) continue;
    let p: ParsedFile;
    try {
      p = parseFile(f, text);
    } catch {
      continue;
    }
    parsed.set(f, p);
    const targets = new Set<string>();
    for (const spec of p.imports) {
      const t = resolveImport(f, spec, files, aliases);
      if (t && t !== f) targets.add(t);
    }
    imports.set(f, targets);
    for (const t of targets) {
      if (!importers.has(t)) importers.set(t, new Set());
      importers.get(t)!.add(f);
    }
  }
  return { sha, files, parsed, imports, importers };
}

/** Number of files that transitively depend on `file`. */
export function blastRadius(g: RepoGraph, file: string): number {
  const seen = new Set<string>();
  const queue = [file];
  while (queue.length) {
    const f = queue.pop()!;
    for (const i of g.importers.get(f) ?? []) if (!seen.has(i) && i !== file) (seen.add(i), queue.push(i));
  }
  return seen.size;
}

/** Top-level grouping: src/<x> or <top-dir>. Next.js app routes get their first route segment. */
export function areaOf(file: string): string {
  const parts = file.split("/");
  if (parts.length === 1) return "(root)";
  if (parts[0] === "src" && parts.length > 2) {
    if (parts[1] === "app" && parts.length > 3) {
      const seg = parts[2];
      if (seg === "api") return parts.length > 4 ? `src/app/api/${parts[3]}` : "src/app/api";
      return `src/app/${seg}`;
    }
    return `src/${parts[1]}`;
  }
  return parts[0];
}

export function routeOf(file: string): { route?: string; role?: "page" | "layout" | "api" } {
  const m = file.match(/^(?:src\/)?app\/(.*?)\/?(page|layout|route)\.(t|j)sx?$/);
  if (!m) return {};
  const route = "/" + m[1].split("/").filter((s) => s && !/^\(.*\)$/.test(s)).join("/");
  return { route, role: m[2] === "route" ? "api" : (m[2] as "page" | "layout") };
}
