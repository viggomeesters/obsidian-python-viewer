export const RENDER_LINE_LIMIT = 10000;

export type PythonSymbolKind = "import" | "class" | "function" | "method" | "decorator" | "constant";
export type DiagnosticSeverity = "error" | "warning";

export interface PythonLine {
  lineNumber: number;
  raw: string;
  indent: number;
  inMultilineString: boolean;
}

export interface PythonSymbol {
  kind: PythonSymbolKind;
  name: string;
  detail: string;
  lineNumber: number;
  column: number;
  indent: number;
  decorators: string[];
  parentClass?: string;
  source: string;
  searchText: string;
}

export interface PythonDiagnostic {
  severity: DiagnosticSeverity;
  label: string;
  message: string;
  lineNumber: number;
  column: number;
}

export interface WarningItem {
  label: string;
  message: string;
}

export interface ParsedPython {
  lines: PythonLine[];
  renderedLines: PythonLine[];
  lineCount: number;
  skippedLines: number;
  symbols: PythonSymbol[];
  diagnostics: PythonDiagnostic[];
  warnings: WarningItem[];
}

interface ClassFrame {
  name: string;
  indent: number;
}

interface TripleState {
  delimiter: "'''" | "\"\"\"" | null;
}

const IMPORT_PATTERN = /^\s*(import\s+[\w.,\s]+|from\s+[\w.]+\s+import\s+.+)\s*(?:#.*)?$/;
const CLASS_PATTERN = /^(\s*)class\s+([A-Za-z_]\w*)\b([^:]*)/;
const FUNCTION_PATTERN = /^(\s*)(async\s+)?def\s+([A-Za-z_]\w*)\s*\((.*)/;
const DECORATOR_PATTERN = /^(\s*)@([\w.]+(?:\(.*\))?)\s*(?:#.*)?$/;
const CONSTANT_PATTERN = /^([A-Z_][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*(.+)$/;

export function parsePython(data: string): ParsedPython {
  const rawLines = splitLines(data);
  const lines = annotateLines(rawLines);
  const renderedLines = lines.slice(0, RENDER_LINE_LIMIT);
  const skippedLines = Math.max(0, lines.length - renderedLines.length);
  const symbols: PythonSymbol[] = [];
  const diagnostics: PythonDiagnostic[] = [];
  const classStack: ClassFrame[] = [];
  let pendingDecorators: PythonSymbol[] = [];

  lines.forEach((line) => {
    if (line.inMultilineString || isCommentOrBlank(line.raw)) return;
    trimClassStack(classStack, line.indent);

    const decorator = parseDecorator(line);
    if (decorator) {
      pendingDecorators.push(decorator);
      symbols.push(decorator);
      return;
    }

    const importSymbol = parseImport(line);
    if (importSymbol) {
      symbols.push(importSymbol);
      pendingDecorators = [];
      return;
    }

    const classSymbol = parseClass(line, pendingDecorators);
    if (classSymbol) {
      symbols.push(classSymbol);
      classStack.push({ name: classSymbol.name, indent: line.indent });
      diagnostics.push(...diagnosticsForBlockHeader(line, "class"));
      pendingDecorators = [];
      return;
    }

    const functionSymbol = parseFunction(line, pendingDecorators, classStack);
    if (functionSymbol) {
      symbols.push(functionSymbol);
      diagnostics.push(...diagnosticsForBlockHeader(line, "function"));
      pendingDecorators = [];
      return;
    }

    const constantSymbol = parseConstant(line);
    if (constantSymbol) {
      symbols.push(constantSymbol);
      pendingDecorators = [];
      return;
    }

    if (line.raw.trim() !== "") pendingDecorators = [];
  });

  const warnings = warningsFor(lines, skippedLines, diagnostics);
  return {
    lines,
    renderedLines,
    lineCount: lines.length,
    skippedLines,
    symbols,
    diagnostics,
    warnings,
  };
}

function splitLines(data: string): string[] {
  if (data.length === 0) return [];
  const lines = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "" && data.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function annotateLines(rawLines: string[]): PythonLine[] {
  const state: TripleState = { delimiter: null };
  return rawLines.map((raw, index) => {
    const startsInMultiline = state.delimiter !== null;
    const hasTripleString = opensTripleString(raw, state);
    const inMultilineString = startsInMultiline || hasTripleString;
    return {
      lineNumber: index + 1,
      raw,
      indent: leadingSpaces(raw),
      inMultilineString,
    };
  });
}

function opensTripleString(raw: string, state: TripleState): boolean {
  let index = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let sawTriple = false;

  while (index < raw.length) {
    const char = raw[index];
    const nextThree = raw.slice(index, index + 3);

    if (state.delimiter) {
      sawTriple = true;
      if (nextThree === state.delimiter) {
        state.delimiter = null;
        index += 3;
        continue;
      }
      index += 1;
      continue;
    }

    if (!inSingle && !inDouble && char === "#") break;
    if (!escaped && !inDouble && nextThree === "'''") {
      state.delimiter = "'''";
      sawTriple = true;
      index += 3;
      continue;
    }
    if (!escaped && !inSingle && nextThree === "\"\"\"") {
      state.delimiter = "\"\"\"";
      sawTriple = true;
      index += 3;
      continue;
    }
    if (!escaped && char === "'" && !inDouble) inSingle = !inSingle;
    if (!escaped && char === "\"" && !inSingle) inDouble = !inDouble;
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
    index += 1;
  }

  return sawTriple || state.delimiter !== null;
}

function leadingSpaces(raw: string): number {
  const match = raw.match(/^ */);
  return match?.[0].length ?? 0;
}

function isCommentOrBlank(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

function trimClassStack(stack: ClassFrame[], indent: number): void {
  while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
    stack.pop();
  }
}

function parseDecorator(line: PythonLine): PythonSymbol | null {
  const match = line.raw.match(DECORATOR_PATTERN);
  if (!match) return null;
  const name = match[2];
  return createSymbol("decorator", name, `@${name}`, line, [], undefined, line.raw.indexOf("@") + 1);
}

function parseImport(line: PythonLine): PythonSymbol | null {
  const match = line.raw.match(IMPORT_PATTERN);
  if (!match) return null;
  const detail = match[1].trim();
  const name = detail.startsWith("from ")
    ? detail.replace(/^from\s+/, "").replace(/\s+import\s+.*$/, "")
    : detail.replace(/^import\s+/, "").split(",")[0].trim();
  return createSymbol("import", name, detail, line, [], undefined, line.raw.indexOf(detail));
}

function parseClass(line: PythonLine, pendingDecorators: PythonSymbol[]): PythonSymbol | null {
  const match = line.raw.match(CLASS_PATTERN);
  if (!match) return null;
  const name = match[2];
  const detail = `class ${name}${match[3] ?? ""}`.trim();
  return createSymbol(
    "class",
    name,
    detail,
    line,
    pendingDecorators.map((decorator) => decorator.name),
    undefined,
    line.raw.indexOf(name),
  );
}

function parseFunction(
  line: PythonLine,
  pendingDecorators: PythonSymbol[],
  classStack: ClassFrame[],
): PythonSymbol | null {
  const match = line.raw.match(FUNCTION_PATTERN);
  if (!match) return null;
  const asyncPrefix = match[2] ? "async " : "";
  const name = match[3];
  const parentClass = findParentClass(classStack, line.indent);
  const kind: PythonSymbolKind = parentClass ? "method" : "function";
  return createSymbol(
    kind,
    name,
    `${asyncPrefix}def ${name}`,
    line,
    pendingDecorators.map((decorator) => decorator.name),
    parentClass,
    line.raw.indexOf(name),
  );
}

function findParentClass(stack: ClassFrame[], indent: number): string | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    if (indent > frame.indent) return frame.name;
  }
  return undefined;
}

function parseConstant(line: PythonLine): PythonSymbol | null {
  if (line.indent !== 0) return null;
  const withoutComment = stripInlineComment(line.raw).trim();
  const match = withoutComment.match(CONSTANT_PATTERN);
  if (!match) return null;
  const name = match[1];
  return createSymbol("constant", name, `${name} =`, line, [], undefined, line.raw.indexOf(name));
}

function stripInlineComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (!escaped && char === "'" && !inDouble) inSingle = !inSingle;
    if (!escaped && char === "\"" && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble && char === "#") return raw.slice(0, index);
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  return raw;
}

function diagnosticsForBlockHeader(line: PythonLine, kind: "class" | "function"): PythonDiagnostic[] {
  const withoutComment = stripInlineComment(line.raw).trimEnd();
  if (withoutComment.endsWith(":")) return [];
  return [
    {
      severity: "error",
      label: "Syntax diagnostic",
      message: `${kind === "class" ? "Class" : "Function"} header is missing a trailing colon.`,
      lineNumber: line.lineNumber,
      column: Math.max(1, line.raw.length),
    },
  ];
}

function createSymbol(
  kind: PythonSymbolKind,
  name: string,
  detail: string,
  line: PythonLine,
  decorators: string[],
  parentClass: string | undefined,
  column: number,
): PythonSymbol {
  const source = line.raw.trim();
  const searchText = [kind, name, detail, parentClass ?? "", decorators.join(" "), source].join(" ").toLowerCase();
  return {
    kind,
    name,
    detail,
    lineNumber: line.lineNumber,
    column: Math.max(1, column + 1),
    indent: line.indent,
    decorators,
    parentClass,
    source,
    searchText,
  };
}

function warningsFor(
  lines: PythonLine[],
  skippedLines: number,
  diagnostics: PythonDiagnostic[],
): WarningItem[] {
  const warnings: WarningItem[] = [];
  if (skippedLines > 0) {
    warnings.push({
      label: "Render cap",
      message: `${skippedLines} lines are not rendered to keep the view responsive.`,
    });
  }
  if (diagnostics.length > 0) {
    warnings.push({
      label: "Parse diagnostics",
      message: `${diagnostics.length} possible syntax issue${diagnostics.length === 1 ? "" : "s"} found. Source view remains available.`,
    });
  }
  if (lines.some((line) => line.inMultilineString)) {
    warnings.push({
      label: "Multiline strings",
      message: "Structure detection skips triple-quoted string bodies to avoid false symbols.",
    });
  }
  return warnings;
}
