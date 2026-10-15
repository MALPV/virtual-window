import { describe, expect, it } from "vitest";

import {
  buildRegistry,
  DEFAULT_SCENE_ID,
  localizedSceneName,
  sceneRegistry,
  validateManifest,
} from "../src/scenes/registry";

const manifest = (overrides: Record<string, unknown> = {}) => ({
  id: "my-scene",
  name: { en: "My scene", es: "Mi escena" },
  author: "Someone",
  license: "MIT",
  apiVersion: 1,
  renderer: "svg",
  ...overrides,
});

describe("bundled scenes", () => {
  it("are all valid", () => {
    expect(sceneRegistry.errors).toEqual([]);
  });

  it("include the default scene first", () => {
    expect(sceneRegistry.scenes[0]?.manifest.id).toBe(DEFAULT_SCENE_ID);
  });

  it("have unique ids", () => {
    const ids = sceneRegistry.scenes.map((scene) => scene.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each load a mountable module", async () => {
    for (const scene of sceneRegistry.scenes) {
      const module = await scene.load();
      expect(typeof module.mount, scene.manifest.id).toBe("function");
    }
  });
});

describe("validateManifest", () => {
  it("accepts a complete manifest and defaults weatherOverlay to true", () => {
    const result = validateManifest(manifest(), "my-scene");
    expect(result.ok && result.manifest.weatherOverlay).toBe(true);
  });

  it.each([
    ["id not matching folder", manifest({ id: "other" })],
    ["non kebab-case id", manifest({ id: "My_Scene" })],
    ["missing english name", manifest({ name: { es: "Mi escena" } })],
    ["empty translated name", manifest({ name: { en: "My scene", es: "" } })],
    ["missing author", manifest({ author: "" })],
    ["missing license", manifest({ license: undefined })],
    ["unsupported api version", manifest({ apiVersion: 2 })],
    ["unknown renderer", manifest({ renderer: "flash" })],
    ["non boolean overlay flag", manifest({ weatherOverlay: "yes" })],
  ])("rejects %s", (_, raw) => {
    expect(validateManifest(raw, "my-scene").ok).toBe(false);
  });
});

describe("buildRegistry", () => {
  it("skips invalid scenes and scenes without an entry module", () => {
    const registry = buildRegistry(
      {
        "./good/manifest.json": manifest({ id: "good" }),
        "./bad/manifest.json": manifest({ id: "BAD" }),
        "./orphan/manifest.json": manifest({ id: "orphan" }),
      },
      {
        "./good/index.ts": async () => ({ default: { mount() {} } }),
        "./bad/index.ts": async () => ({ default: { mount() {} } }),
      },
    );
    expect(registry.scenes.map((scene) => scene.manifest.id)).toEqual(["good"]);
    expect(registry.errors).toHaveLength(2);
  });

  it("rejects modules without a mount function when loading", async () => {
    const registry = buildRegistry(
      { "./broken/manifest.json": manifest({ id: "broken" }) },
      { "./broken/index.ts": async () => ({ default: {} }) },
    );
    await expect(registry.scenes[0]?.load()).rejects.toThrow(/default-export/);
  });
});

describe("localizedSceneName", () => {
  const validated = validateManifest(manifest({ name: { en: "Rooftops", es: "Tejados", "pt-BR": "Telhados" } }), "my-scene");
  if (!validated.ok) throw new Error(validated.error);

  it("prefers the exact locale, then the language, then english", () => {
    expect(localizedSceneName(validated.manifest, "pt-BR")).toBe("Telhados");
    expect(localizedSceneName(validated.manifest, "es-CL")).toBe("Tejados");
    expect(localizedSceneName(validated.manifest, "de-DE")).toBe("Rooftops");
  });
});
