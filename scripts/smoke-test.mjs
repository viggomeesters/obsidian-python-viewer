import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const main = fs.readFileSync("src/main.ts", "utf8");
const parser = fs.readFileSync("src/parser.ts", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const forbiddenRuntimePatterns = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "navigator.clipboard",
  "child_process",
  "spawn(",
  "exec(",
  "eval(",
  "new Function",
];

const assertions = [
  [manifest.id === "python-viewer", "manifest id is python-viewer"],
  [manifest.version === "0.1.0", "manifest version is 0.1.0"],
  [main.includes("registerExtensions(PYTHON_EXTENSIONS"), "extensions are registered"],
  [main.includes("type ViewMode = \"structure\" | \"source\""), "structure/source mode exists"],
  [main.includes("renderStructure(container, parsed, this.filterValue"), "structure view code path exists"],
  [main.includes("renderSource(container, parsed.renderedLines"), "source view code path exists"],
  [parser.includes("RENDER_LINE_LIMIT = 10000"), "render cap exists"],
  [parser.includes("parsePython"), "parser entrypoint exists"],
  [forbiddenRuntimePatterns.every((pattern) => !main.includes(pattern) && !parser.includes(pattern)), "no forbidden runtime APIs"],
  [!styles.includes("!important"), "styles do not use important overrides"],
  [["main.js", "manifest.json", "styles.css"].every((file) => fs.existsSync(file)), "runtime assets exist"],
];

const failures = assertions.filter(([passes]) => !passes).map(([, label]) => label);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  process.exit(1);
}

console.log("Python Viewer smoke checks passed.");
