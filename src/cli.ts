import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { analyze } from "./analyze.ts";

const HELP = `wakemap: see what your AI agent left behind

Usage
  wakemap analyze --repo <path> --base <ref> --head <ref> [--transcript <file>]... [--root <dir>]... [--out <file>]
  wakemap show [<wakemap.json>] [--port 4173]

analyze  Builds the change map between two revisions and links each change to the
         Claude Code session that made it. Transcripts are found automatically under
         ~/.claude/projects unless --transcript is given.
show     Opens the interactive map in your browser.
`;

const here = dirname(fileURLToPath(import.meta.url));

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "analyze") {
    const { values } = parseArgs({
      args: rest,
      options: {
        repo: { type: "string", default: "." },
        base: { type: "string" },
        head: { type: "string", default: "HEAD" },
        transcript: { type: "string", multiple: true },
        root: { type: "string", multiple: true },
        out: { type: "string" },
        context: { type: "string" },
      },
    });
    if (!values.base) return fail("--base is required");
    const t0 = Date.now();
    const map = analyze({
      repo: values.repo!,
      base: values.base,
      head: values.head!,
      transcripts: values.transcript,
      roots: values.root,
      contextLimit: values.context ? Number(values.context) : undefined,
    });
    const out = resolve(values.out ?? join(values.repo!, ".wakemap", `${map.head.sha.slice(0, 8)}.json`));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(map, null, 1));
    const changed = map.files.filter((f) => !f.context);
    console.log(`${map.title}`);
    console.log(`  ${changed.length} files changed, ${map.files.length - changed.length} neighbours, ${map.edges.length} edges`);
    console.log(`  ${map.units.length} agent prompts linked, ${map.unattributed.length} changes without an agent edit`);
    console.log(`  risk: ${map.risk.band} (score ${map.risk.score}, ${map.risk.flags.length} flags)`);
    console.log(`  wrote ${out} in ${Date.now() - t0}ms`);
    return;
  }
  if (cmd === "show") {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { port: { type: "string", default: "4173" } } });
    const file = resolve(positionals[0] ?? "wakemap.json");
    if (!existsSync(file)) return fail(`no map at ${file}; run \`wakemap analyze\` first`);
    const dist = resolve(here, "../viewer/dist");
    if (!existsSync(dist)) return fail("viewer not built; run `npm run build:viewer`");
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
    createServer((req, res) => {
      const url = (req.url ?? "/").split("?")[0];
      if (url === "/wakemap.json") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(readFileSync(file));
      }
      const p = join(dist, url === "/" ? "index.html" : url);
      if (!p.startsWith(dist) || !existsSync(p)) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" });
      res.end(readFileSync(p));
    }).listen(Number(values.port), () => console.log(`wakemap: http://localhost:${values.port}`));
    return;
  }
  console.log(HELP);
}

function fail(msg: string) {
  console.error(`wakemap: ${msg}`);
  process.exit(1);
}

main();
