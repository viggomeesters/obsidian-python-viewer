import assert from "node:assert/strict";
import fs from "node:fs";
import esbuild from "esbuild";

await esbuild.build({
  bundle: true,
  entryPoints: ["src/parser.ts"],
  format: "esm",
  outfile: ".tmp-parser-test.mjs",
  platform: "node",
  target: "node20",
});

const { parsePython } = await import(new URL("../.tmp-parser-test.mjs", import.meta.url));

function readFixture(name) {
  return fs.readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8");
}

const simple = parsePython(readFixture("simple.py"));
assert.equal(simple.lineCount, 12);
assert.ok(simple.symbols.some((symbol) => symbol.kind === "import" && symbol.name === "os"));
assert.ok(simple.symbols.some((symbol) => symbol.kind === "constant" && symbol.name === "DEFAULT_LIMIT"));
assert.ok(simple.symbols.some((symbol) => symbol.kind === "function" && symbol.name === "load_items"));
assert.equal(simple.diagnostics.length, 0);

const decorators = parsePython(readFixture("decorators.py"));
assert.ok(decorators.symbols.some((symbol) => symbol.kind === "decorator" && symbol.name === "dataclass"));
const classSymbol = decorators.symbols.find((symbol) => symbol.kind === "class" && symbol.name === "Job");
assert.ok(classSymbol);
assert.deepEqual(classSymbol.decorators, ["dataclass"]);
const method = decorators.symbols.find((symbol) => symbol.kind === "method" && symbol.name === "run");
assert.ok(method);
assert.equal(method.parentClass, "Job");
assert.deepEqual(method.decorators, ["staticmethod"]);

const nested = parsePython(readFixture("nested.py"));
assert.ok(nested.symbols.some((symbol) => symbol.kind === "function" && symbol.name === "outer"));
assert.ok(nested.symbols.some((symbol) => symbol.kind === "function" && symbol.name === "inner"));
assert.ok(nested.symbols.some((symbol) => symbol.kind === "function" && symbol.name === "fetch_data"));

const multiline = parsePython(readFixture("multiline.py"));
assert.ok(multiline.warnings.some((warning) => warning.label === "Multiline strings"));
assert.ok(!multiline.symbols.some((symbol) => symbol.name === "fake_function"));
assert.ok(multiline.symbols.some((symbol) => symbol.name === "real_function"));

const syntaxError = parsePython(readFixture("syntax-error.py"));
assert.ok(syntaxError.diagnostics.some((diagnostic) => diagnostic.lineNumber === 1));
assert.ok(syntaxError.warnings.some((warning) => warning.label === "Parse diagnostics"));

const largePython = Array.from({ length: 10005 }, (_, index) => `VALUE_${index} = ${index}`).join("\n");
const large = parsePython(largePython);
assert.equal(large.renderedLines.length, 10000);
assert.equal(large.skippedLines, 5);
assert.ok(large.warnings.some((warning) => warning.label === "Render cap"));

fs.rmSync(new URL("../.tmp-parser-test.mjs", import.meta.url));
console.log("Python parser fixture tests passed.");
