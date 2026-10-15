import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parser } from "@shaderfrog/glsl-parser";
import { describe, expect, it } from "vitest";

import { FULLSCREEN_VERTEX_SHADER } from "../src/scenes/shader-scene";

// Sin GPU en CI no se pueden compilar los shaders, pero si analizarlos: detecta errores de sintaxis
// y variables o funciones no declaradas antes de que la escena falle en el equipo de un usuario.
const SCENES_DIR = fileURLToPath(new URL("../src/scenes", import.meta.url));
const STAGES = { ".frag": "fragment", ".vert": "vertex" } as const;

function shaderFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return shaderFiles(path);
    return extname(entry.name) in STAGES ? [path] : [];
  });
}

const files = shaderFiles(SCENES_DIR);

describe("scene shaders", () => {
  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("built-in full-screen vertex shader parses strictly", () => {
    expect(() => parser.parse(FULLSCREEN_VERTEX_SHADER, { stage: "vertex", failOnWarn: true, quiet: true })).not.toThrow();
  });

  it.each(files.map((file) => [relative(SCENES_DIR, file), file]))("%s parses strictly", (_, file) => {
    const stage = STAGES[extname(file) as keyof typeof STAGES];
    expect(() => parser.parse(readFileSync(file, "utf8"), { stage, failOnWarn: true, quiet: true })).not.toThrow();
  });
});
