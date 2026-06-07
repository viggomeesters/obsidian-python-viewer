import {
  Notice,
  Plugin,
  TFile,
  TextFileView,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import {
  ParsedPython,
  PythonDiagnostic,
  PythonLine,
  PythonSymbol,
  PythonSymbolKind,
  WarningItem,
  parsePython,
} from "./parser";

const VIEW_TYPE_PYTHON_VIEWER = "python-viewer";
const PYTHON_EXTENSIONS = ["py"];

type ViewMode = "structure" | "source";

const SYMBOL_LABELS: Record<PythonSymbolKind, string> = {
  class: "Class",
  constant: "Constant",
  decorator: "Decorator",
  function: "Function",
  import: "Import",
  method: "Method",
};

const KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);

export default class PythonViewerPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(
      VIEW_TYPE_PYTHON_VIEWER,
      (leaf) => new PythonViewerView(leaf),
    );
    this.registerExtensions(PYTHON_EXTENSIONS, VIEW_TYPE_PYTHON_VIEWER);

    this.addCommand({
      id: "open-current-python-in-viewer",
      name: "Open current Python file in viewer",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!isPythonFile(file)) return false;

        if (!checking) {
          void this.openPythonFile(file);
        }
        return true;
      },
    });
  }

  async openPythonFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_PYTHON_VIEWER,
      state: { file: file.path },
      active: true,
    });
  }
}

class PythonViewerView extends TextFileView {
  private mode: ViewMode = "structure";
  private filterValue = "";
  private jumpLine: number | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_PYTHON_VIEWER;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Python viewer";
  }

  getIcon(): string {
    return "file-code-2";
  }

  setViewData(data: string): void {
    this.data = data;
    this.render();
  }

  getViewData(): string {
    return this.data;
  }

  clear(): void {
    this.data = "";
    this.contentEl.empty();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("python-viewer");

    const header = container.createDiv({ cls: "python-viewer__header" });
    this.renderTitle(header);
    this.renderToolbar(header);

    if (!this.file) {
      renderMessage(container, "No Python file is attached to this viewer.");
      return;
    }

    if (!isPythonFile(this.file)) {
      renderMessage(container, "This viewer only supports .py files.");
      return;
    }

    const parsed = parsePython(this.data);
    renderSummary(container, parsed);
    renderDiagnostics(container, parsed.diagnostics);
    renderWarnings(container, parsed.warnings);

    if (!this.data.trim()) {
      renderMessage(container, "This Python file is empty.");
      return;
    }

    if (this.mode === "source") {
      renderSource(container, parsed.renderedLines, parsed.diagnostics, this.filterValue, this.jumpLine);
      this.scrollToJumpLine(container);
      return;
    }

    renderStructure(container, parsed, this.filterValue, (lineNumber) => {
      this.mode = "source";
      this.jumpLine = lineNumber;
      this.render();
    });
  }

  private renderTitle(parent: HTMLElement): void {
    const title = parent.createDiv({ cls: "python-viewer__title" });
    title.createDiv({
      cls: "python-viewer__filename",
      text: this.file?.name ?? "Python file",
    });
    title.createDiv({
      cls: "python-viewer__path",
      text: this.file?.path ?? "",
    });
  }

  private renderToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "python-viewer__toolbar" });

    const searchWrap = toolbar.createDiv({ cls: "python-viewer__search" });
    setIcon(searchWrap.createSpan({ cls: "python-viewer__search-icon" }), "search");
    const searchInput = searchWrap.createEl("input", {
      attr: {
        "aria-label": "Filter Python symbols and source",
        placeholder: "Filter",
        spellcheck: "false",
        type: "search",
        value: this.filterValue,
      },
    });
    searchInput.addEventListener("input", () => {
      this.filterValue = searchInput.value;
      this.jumpLine = null;
      this.render();
    });

    const modeGroup = toolbar.createDiv({
      cls: "python-viewer__segmented",
      attr: { "aria-label": "View mode" },
    });
    const structureButton = createTextButton(modeGroup, "Structure");
    const sourceButton = createTextButton(modeGroup, "Source");
    structureButton.toggleClass("is-active", this.mode === "structure");
    sourceButton.toggleClass("is-active", this.mode === "source");

    structureButton.addEventListener("click", () => {
      this.mode = "structure";
      this.jumpLine = null;
      this.render();
    });
    sourceButton.addEventListener("click", () => {
      this.mode = "source";
      this.render();
    });

    const refreshButton = createIconButton(toolbar, "refresh-cw", "Refresh file");
    refreshButton.addEventListener("click", () => {
      void this.reloadFile();
    });
  }

  private async reloadFile(): Promise<void> {
    if (!this.file) {
      new Notice("No Python file to refresh");
      return;
    }

    try {
      this.data = await this.app.vault.read(this.file);
      this.render();
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.addClass("python-viewer");
      renderMessage(this.contentEl, `Unable to read Python file: ${getErrorMessage(error)}`);
    }
  }

  private scrollToJumpLine(container: HTMLElement): void {
    if (this.jumpLine === null) return;
    const lineNumber = this.jumpLine;
    window.requestAnimationFrame(() => {
      const target = container.querySelector(`[data-line="${lineNumber}"]`);
      target?.scrollIntoView({ block: "center" });
      this.jumpLine = null;
    });
  }
}

function renderSummary(parent: HTMLElement, parsed: ParsedPython): void {
  const summary = parent.createDiv({ cls: "python-viewer__summary" });
  summary.createSpan({ cls: "python-viewer__pill", text: `${parsed.lineCount} lines` });
  summary.createSpan({ cls: "python-viewer__pill", text: `${parsed.symbols.length} symbols` });
  summary.createSpan({ cls: "python-viewer__pill", text: `${parsed.diagnostics.length} diagnostics` });
  if (parsed.skippedLines > 0) {
    summary.createSpan({
      cls: "python-viewer__note",
      text: `${parsed.renderedLines.length} lines rendered`,
    });
  }
}

function renderDiagnostics(parent: HTMLElement, diagnostics: PythonDiagnostic[]): void {
  if (diagnostics.length === 0) return;
  const box = parent.createDiv({ cls: "python-viewer__diagnostics" });
  box.createDiv({ cls: "python-viewer__diagnostics-title", text: "Parse diagnostics" });
  diagnostics.slice(0, 12).forEach((diagnostic) => {
    box.createDiv({
      cls: `python-viewer__diagnostic python-viewer__diagnostic--${diagnostic.severity}`,
      text: `${diagnostic.lineNumber}:${diagnostic.column} ${diagnostic.message}`,
    });
  });
  if (diagnostics.length > 12) {
    box.createDiv({
      cls: "python-viewer__diagnostic-more",
      text: `${diagnostics.length - 12} additional diagnostics hidden`,
    });
  }
}

function renderWarnings(parent: HTMLElement, warnings: WarningItem[]): void {
  if (warnings.length === 0) return;
  const box = parent.createDiv({ cls: "python-viewer__warnings" });
  box.createDiv({ cls: "python-viewer__warnings-title", text: "Parser notes" });
  warnings.slice(0, 8).forEach((warning) => {
    box.createDiv({
      cls: "python-viewer__warning",
      text: `${warning.label}: ${warning.message}`,
    });
  });
  if (warnings.length > 8) {
    box.createDiv({
      cls: "python-viewer__warning-more",
      text: `${warnings.length - 8} additional notes hidden`,
    });
  }
}

function renderStructure(
  parent: HTMLElement,
  parsed: ParsedPython,
  query: string,
  onJump: (lineNumber: number) => void,
): void {
  const normalizedQuery = query.trim().toLowerCase();
  const symbols = normalizedQuery
    ? parsed.symbols.filter((symbol) => symbol.searchText.includes(normalizedQuery))
    : parsed.symbols;

  if (symbols.length === 0) {
    renderMessage(parent, normalizedQuery ? "No symbols match the current filter." : "No Python symbols found.");
    return;
  }

  const body = parent.createDiv({ cls: "python-viewer__body" });
  const groups = groupSymbols(symbols);
  groups.forEach(([kind, items]) => {
    const section = body.createEl("section", { cls: "python-viewer__symbol-section" });
    section.createDiv({
      cls: "python-viewer__section-title",
      text: `${SYMBOL_LABELS[kind]}s`,
    });
    items.forEach((symbol) => renderSymbol(section, symbol, onJump));
  });
}

function groupSymbols(symbols: PythonSymbol[]): Array<[PythonSymbolKind, PythonSymbol[]]> {
  const order: PythonSymbolKind[] = ["import", "decorator", "class", "function", "method", "constant"];
  return order
    .map((kind) => [kind, symbols.filter((symbol) => symbol.kind === kind)] as [PythonSymbolKind, PythonSymbol[]])
    .filter(([, items]) => items.length > 0);
}

function renderSymbol(
  parent: HTMLElement,
  symbol: PythonSymbol,
  onJump: (lineNumber: number) => void,
): void {
  const row = parent.createEl("button", {
    cls: `python-viewer__symbol python-viewer__symbol--${symbol.kind}`,
    attr: { type: "button" },
  });
  row.addEventListener("click", () => onJump(symbol.lineNumber));

  row.createSpan({ cls: "python-viewer__symbol-line", text: String(symbol.lineNumber) });
  row.createSpan({ cls: "python-viewer__symbol-kind", text: SYMBOL_LABELS[symbol.kind] });
  const main = row.createSpan({ cls: "python-viewer__symbol-main" });
  main.createSpan({ cls: "python-viewer__symbol-name", text: symbol.name });
  if (symbol.parentClass) {
    main.createSpan({ cls: "python-viewer__symbol-parent", text: ` in ${symbol.parentClass}` });
  }
  if (symbol.decorators.length > 0) {
    main.createSpan({ cls: "python-viewer__symbol-decorators", text: ` @${symbol.decorators.join(" @")}` });
  }
  row.createSpan({ cls: "python-viewer__symbol-detail", text: symbol.detail });
}

function renderSource(
  parent: HTMLElement,
  lines: PythonLine[],
  diagnostics: PythonDiagnostic[],
  query: string,
  jumpLine: number | null,
): void {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleLines = normalizedQuery
    ? lines.filter((line) => line.raw.toLowerCase().includes(normalizedQuery))
    : lines;

  if (visibleLines.length === 0) {
    renderMessage(parent, "No source lines match the current filter.");
    return;
  }

  const source = parent.createDiv({ cls: "python-viewer__source" });
  const diagnosticLines = new Map(diagnostics.map((diagnostic) => [diagnostic.lineNumber, diagnostic.severity]));
  visibleLines.forEach((line) => {
    const severity = diagnosticLines.get(line.lineNumber);
    const row = source.createDiv({
      cls: [
        "python-viewer__source-row",
        jumpLine === line.lineNumber ? "is-jump-target" : "",
        severity ? `has-diagnostic has-diagnostic--${severity}` : "",
      ].filter(Boolean).join(" "),
      attr: { "data-line": String(line.lineNumber) },
    });
    row.createDiv({ cls: "python-viewer__line-number", text: String(line.lineNumber) });
    const code = row.createDiv({ cls: "python-viewer__code" });
    renderHighlightedLine(code, line.raw);
  });
}

function renderHighlightedLine(parent: HTMLElement, raw: string): void {
  if (raw.trim() === "") {
    parent.createSpan({ text: " " });
    return;
  }

  const commentIndex = findCommentIndex(raw);
  const codePart = commentIndex === -1 ? raw : raw.slice(0, commentIndex);
  const commentPart = commentIndex === -1 ? "" : raw.slice(commentIndex);
  renderCodePart(parent, codePart);
  if (commentPart) parent.createSpan({ cls: "python-viewer__token-comment", text: commentPart });
}

function renderCodePart(parent: HTMLElement, text: string): void {
  const definitionNames = new Set(Array.from(text.matchAll(/\b(?:async\s+def|def|class)\s+([A-Za-z_]\w*)/g)).map((match) => match[1]));
  const importNames = new Set(Array.from(text.matchAll(/\b(?:import|from|as)\s+([A-Za-z_][\w.]*)/g)).map((match) => match[1]));
  const pattern = /(@[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w.]*\b|'''|"""|'[^']*'|"[^"]*")/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) parent.createSpan({ text: text.slice(lastIndex, index) });
    parent.createSpan({ cls: tokenClass(token, definitionNames, importNames), text: token });
    lastIndex = index + token.length;
  }
  if (lastIndex < text.length) parent.createSpan({ text: text.slice(lastIndex) });
}

function tokenClass(token: string, definitionNames: Set<string>, importNames: Set<string>): string {
  if (token.startsWith("@")) return "python-viewer__token-decorator";
  if (token.startsWith("'") || token.startsWith("\"")) return "python-viewer__token-string";
  if (/^\d/.test(token)) return "python-viewer__token-number";
  if (definitionNames.has(token)) return "python-viewer__token-definition";
  if (importNames.has(token)) return "python-viewer__token-import";
  if (KEYWORDS.has(token)) return "python-viewer__token-keyword";
  if (/^[A-Z_][A-Z0-9_]*$/.test(token)) return "python-viewer__token-constant";
  return "python-viewer__token-name";
}

function findCommentIndex(raw: string): number {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (!escaped && char === "'" && !inDouble) inSingle = !inSingle;
    if (!escaped && char === "\"" && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble && char === "#") return index;
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  return -1;
}

function createTextButton(parent: HTMLElement, label: string): HTMLButtonElement {
  return parent.createEl("button", {
    cls: "python-viewer__text-button",
    text: label,
    attr: { type: "button" },
  });
}

function createIconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: "clickable-icon python-viewer__button",
    attr: { "aria-label": label, title: label, type: "button" },
  });
  setIcon(button, icon);
  return button;
}

function renderMessage(parent: HTMLElement, message: string): void {
  parent.createDiv({ cls: "python-viewer__message", text: message });
}

function isPythonFile(file: TFile | null): file is TFile {
  return file instanceof TFile && file.extension.toLowerCase() === "py";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
