import type { FileNode, RiskFlag } from "../model.ts";

// Deterministic rules. Each flag points at a file (and line when possible) so the map can show it.

const SENSITIVE: [RegExp, string][] = [
  [/(^|\/)(auth|login|session|oauth|password|token|crypto|middleware)[^/]*\.|\/(auth|oauth)\//i, "authentication or session code"],
  [/(payment|billing|stripe|checkout|invoice)/i, "payments"],
  [/(^|\/)(migrations?|db)\/.*\.(sql|ts)$/i, "database schema or migration"],
  [/(^|\/)\.env|secrets?|credentials/i, "secrets or environment"],
  [/(^|\/)(wrangler\.(toml|jsonc?)|Dockerfile|docker-compose|\.github\/workflows\/|terraform|.*\.tf$)/i, "deploy or CI configuration"],
  [/(^|\/)\.claude\/|(^|\/)(AGENTS|CLAUDE)\.md$/i, "agent instructions or settings"],
  [/(^|\/)(eslint\.config|\.eslintrc|tsconfig|biome)\b/i, "lint or type-check configuration"],
];

const SUPPRESSIONS = /(eslint-disable|@ts-ignore|@ts-nocheck|@ts-expect-error|as any\b|: any\b|\.skip\(|\.only\(|xit\(|it\.todo)/;
const ASSERTION = /\b(expect|assert(\.\w+)?|should)\s*\(/;

export const isTest = (p: string) => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[tj]sx?$/.test(p);

export function fileRisk(f: FileNode): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (f.context) return flags;
  const added = f.hunks.flatMap((h) => h.lines.filter((l) => l.startsWith("+")).map((l) => l.slice(1)));
  const removed = f.hunks.flatMap((h) => h.lines.filter((l) => l.startsWith("-")).map((l) => l.slice(1)));

  for (const [re, what] of SENSITIVE) {
    if (re.test(f.id)) {
      flags.push({ rule: "sensitive-path", level: "high", file: f.id, message: `Touches ${what}` });
      break;
    }
  }

  if (isTest(f.id)) {
    if (f.status === "removed") flags.push({ rule: "test-deleted", level: "high", file: f.id, message: "Test file deleted" });
    const lost = removed.filter((l) => ASSERTION.test(l)).length - added.filter((l) => ASSERTION.test(l)).length;
    if (lost > 0) flags.push({ rule: "assertions-removed", level: "high", file: f.id, message: `${lost} assertion${lost > 1 ? "s" : ""} removed from tests` });
  }

  const supp = added.filter((l) => SUPPRESSIONS.test(l));
  if (supp.length) {
    const line = locateAdded(f, (l) => SUPPRESSIONS.test(l));
    flags.push({ rule: "checks-suppressed", level: "warn", file: f.id, line, message: `Adds ${supp.length} lint/type/test suppression${supp.length > 1 ? "s" : ""} (${supp[0].trim().slice(0, 60)})` });
  }

  const exportedSig = f.symbols.filter((s) => s.exported && (s.status === "removed" || s.signatureChanged));
  if (exportedSig.length && f.importedBy > 0) {
    flags.push({
      rule: "contract-changed",
      level: f.importedBy >= 3 ? "high" : "warn",
      file: f.id,
      line: exportedSig[0].lines[0],
      message: `Changes exported ${exportedSig.map((s) => s.name).join(", ")} used by ${f.importedBy} file${f.importedBy > 1 ? "s" : ""}`,
    });
  }

  if (f.id.endsWith("package.json")) {
    const deps = added.filter((l) => /^\s*"[@\w][^"]*":\s*"[\^~]?\d/.test(l)).map((l) => l.trim().split('"')[1]);
    const removedDeps = new Set(removed.filter((l) => /^\s*"[@\w][^"]*":\s*"/.test(l)).map((l) => l.trim().split('"')[1]));
    const fresh = deps.filter((d) => !removedDeps.has(d));
    if (fresh.length) flags.push({ rule: "new-dependency", level: "warn", file: f.id, message: `New dependenc${fresh.length > 1 ? "ies" : "y"}: ${fresh.join(", ")}` });
  }

  if (f.blastRadius >= 15 && f.status === "modified") {
    flags.push({ rule: "wide-blast-radius", level: "info", file: f.id, message: `${f.blastRadius} files depend on this file` });
  }
  return flags;
}

function locateAdded(f: FileNode, pred: (l: string) => boolean): number | undefined {
  for (const h of f.hunks) {
    const m = h.header.match(/\+(\d+)/);
    let n = m ? Number(m[1]) : 0;
    for (const l of h.lines) {
      if (l.startsWith("+")) {
        if (pred(l.slice(1))) return n;
        n++;
      } else if (l.startsWith(" ")) n++;
    }
  }
  return undefined;
}

const WEIGHT = { info: 1, warn: 3, high: 8 } as const;

export function scoreRisk(flags: RiskFlag[], unattributed: number): { score: number; band: "low" | "review" | "expert" } {
  const score = flags.reduce((s, f) => s + WEIGHT[f.level], 0) + unattributed * 2;
  const hardHigh = flags.some((f) => f.rule === "test-deleted" || f.rule === "assertions-removed" || f.rule === "sensitive-path");
  return { score, band: hardHigh || score >= 24 ? "expert" : score >= 4 ? "review" : "low" };
}
