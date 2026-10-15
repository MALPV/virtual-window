import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parser } from "@shaderfrog/glsl-parser";
import { describe, expect, it } from "vitest";

import { FULLSCREEN_VERTEX_SHADER, resolveIncludes } from "../src/scenes/shader-scene";

// Sin GPU en CI no se pueden compilar los shaders, pero si analizarlos: detecta errores de sintaxis
// y variables o funciones no declaradas antes de que la escena falle en el equipo de un usuario.
const ROOTS = ["../src/scenes", "../src/frame"].map((path) => fileURLToPath(new URL(path, import.meta.url)));
const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));
const STAGES = { ".frag": "fragment", ".vert": "vertex" } as const;

function shaderFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return shaderFiles(path);
    return extname(entry.name) in STAGES ? [path] : [];
  });
}

// Los fragmentos .glsl de la misma carpeta se pueden incluir con #include "nombre.glsl".
function siblingChunks(file: string): Record<string, string> {
  const dir = dirname(file);
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => extname(name) === ".glsl")
      .map((name) => [basename(name), readFileSync(join(dir, name), "utf8")]),
  );
}

function parseStrict(source: string, stage: "fragment" | "vertex"): void {
  parser.parse(source, { stage, failOnWarn: true, quiet: true });
}

const files = ROOTS.flatMap(shaderFiles);

describe("shaders", () => {
  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("built-in full-screen vertex shader parses strictly", () => {
    expect(() => parseStrict(FULLSCREEN_VERTEX_SHADER, "vertex")).not.toThrow();
  });

  it.each(files.map((file) => [relative(SRC_DIR, file), file]))("%s parses strictly", (_, file) => {
    const stage = STAGES[extname(file) as keyof typeof STAGES];
    const source = resolveIncludes(readFileSync(file, "utf8"), siblingChunks(file));
    expect(() => parseStrict(source, stage)).not.toThrow();
  });
});

describe("resolveIncludes", () => {
  it("inlines chunks, including nested ones", () => {
    const resolved = resolveIncludes('#include "a.glsl"\nvoid main() {}', {
      "a.glsl": '#include "b.glsl"\nfloat a() { return b(); }',
      "b.glsl": "float b() { return 1.0; }",
    });
    expect(resolved).toContain("float b()");
    expect(resolved).toContain("float a()");
    expect(resolved).not.toContain("#include");
  });

  it("rejects missing chunks and cycles", () => {
    expect(() => resolveIncludes('#include "missing.glsl"', {})).toThrow(/Missing/);
    expect(() => resolveIncludes('#include "loop.glsl"', { "loop.glsl": '#include "loop.glsl"' })).toThrow(/deeply/);
  });
});
