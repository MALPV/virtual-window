import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

// El CSS de todas las escenas convive en la misma pagina: cada escena debe quedarse en su ambito.
const SCENES_DIR = fileURLToPath(new URL("../src/scenes", import.meta.url));

const sceneFolders = readdirSync(SCENES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((folder) => existsSync(join(SCENES_DIR, folder, "manifest.json")))
  // Las escenas que solo dibujan en un lienzo pueden no tener CSS.
  .filter((folder) => cssFiles(folder).length > 0);

function cssFiles(folder: string): string[] {
  return readdirSync(join(SCENES_DIR, folder))
    .filter((file) => file.endsWith(".css"))
    .map((file) => join(SCENES_DIR, folder, file));
}

function isInsideKeyframes(rule: Rule): boolean {
  const parent = rule.parent;
  return parent?.type === "atrule" && /keyframes$/i.test((parent as AtRule).name);
}

describe.each(sceneFolders)("scene %s", (folder) => {
  const manifest = JSON.parse(readFileSync(join(SCENES_DIR, folder, "manifest.json"), "utf8")) as { id: string };
  const scope = `[data-scene="${manifest.id}"]`;

  it.each(cssFiles(folder))("%s keeps selectors and keyframes scoped", (file) => {
    const root = postcss.parse(readFileSync(file, "utf8"), { from: file });
    const violations: string[] = [];

    root.walkRules((rule) => {
      if (isInsideKeyframes(rule)) return;
      for (const selector of rule.selectors) {
        if (!selector.trim().startsWith(scope)) violations.push(`selector "${selector}" must start with ${scope}`);
      }
    });
    root.walkAtRules(/keyframes$/i, (atRule) => {
      if (!atRule.params.startsWith(`${manifest.id}-`)) {
        violations.push(`@keyframes "${atRule.params}" must be prefixed with "${manifest.id}-"`);
      }
    });

    expect(violations).toEqual([]);
  });
});
