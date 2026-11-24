import { createHash } from "node:crypto";
import ts from "typescript";
import type { SymbolKind } from "../model.ts";

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  start: number; // 1-based line
  end: number;
  signatureHash: string;
  bodyHash: string;
}

export interface ParsedFile {
  symbols: ParsedSymbol[];
  imports: string[]; // raw module specifiers (static, re-export and dynamic import)
}

const hash = (s: string) => createHash("sha1").update(s.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);

export function isCodeFile(path: string): boolean {
  return /\.(m|c)?(t|j)sx?$/.test(path) && !path.endsWith(".d.ts");
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.(m|c)?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function hasExport(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

const isComponentName = (n: string) => /^[A-Z]/.test(n);

/** Signature = everything except the body, so body-only edits do not count as contract changes. */
function signatureText(sf: ts.SourceFile, node: ts.Node): string {
  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const params = node.parameters.map((p) => p.getText(sf)).join(",");
    return `(${params})=>${node.type?.getText(sf) ?? ""}`;
  }
  if (ts.isClassDeclaration(node)) {
    return node.members
      .filter((m) => !(ts.canHaveModifiers(m) && ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword)))
      .map((m) => (ts.isMethodDeclaration(m) ? `${m.name.getText(sf)}(${m.parameters.map((p) => p.getText(sf)).join(",")})` : m.name?.getText(sf) ?? ""))
      .join(";");
  }
  // interfaces, types, enums: the declaration is the contract
  return node.getText(sf);
}

export function parseFile(path: string, text: string): ParsedFile {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  const symbols: ParsedSymbol[] = [];
  const imports: string[] = [];
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const add = (name: string, kind: SymbolKind, exported: boolean, node: ts.Node, sigNode: ts.Node) => {
    symbols.push({
      name,
      kind,
      exported,
      start: line(node.getStart(sf)),
      end: line(node.getEnd()),
      signatureHash: hash(signatureText(sf, sigNode)),
      bodyHash: hash(node.getText(sf)),
    });
  };

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      imports.push(stmt.moduleSpecifier.text);
      continue;
    }
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      imports.push(stmt.moduleSpecifier.text);
      continue;
    }
    const exported = hasExport(stmt);
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      add(stmt.name.text, isComponentName(stmt.name.text) && path.endsWith("x") ? "component" : "function", exported, stmt, stmt);
    } else if (ts.isFunctionDeclaration(stmt) && !stmt.name && exported) {
      add("default", "function", true, stmt, stmt);
    } else if (ts.isClassDeclaration(stmt)) {
      add(stmt.name?.text ?? "default", "class", exported, stmt, stmt);
    } else if (ts.isInterfaceDeclaration(stmt)) {
      add(stmt.name.text, "interface", exported, stmt, stmt);
    } else if (ts.isTypeAliasDeclaration(stmt)) {
      add(stmt.name.text, "type", exported, stmt, stmt);
    } else if (ts.isEnumDeclaration(stmt)) {
      add(stmt.name.text, "enum", exported, stmt, stmt);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        const fn = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined;
        const kind: SymbolKind = fn ? (isComponentName(d.name.text) && path.endsWith("x") ? "component" : "function") : "const";
        add(d.name.text, kind, exported, stmt.declarationList.declarations.length === 1 ? stmt : d, fn ?? d);
      }
    } else if (ts.isExportAssignment(stmt)) {
      add("default", "const", true, stmt, stmt);
    }
  }

  // dynamic import("x") and require("x") anywhere in the file
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        imports.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { symbols, imports };
}
