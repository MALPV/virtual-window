import { SCENE_API_VERSION } from "../engine/world";
import { SCENE_RENDERERS, type SceneManifest, type SceneModule, type SceneRenderer } from "./types";

export const DEFAULT_SCENE_ID = "alpine-lake";

const SCENE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 48;

type ModuleLoader = () => Promise<unknown>;

export interface SceneEntry {
  manifest: SceneManifest;
  load(): Promise<SceneModule>;
}

export interface SceneRegistry {
  scenes: SceneEntry[];
  errors: string[];
}

type ValidationResult = { ok: true; manifest: SceneManifest } | { ok: false; error: string };

function isNonEmptyString(value: unknown, maxLength = Number.POSITIVE_INFINITY): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function isValidSceneId(id: unknown): id is string {
  return typeof id === "string" && id.length <= MAX_ID_LENGTH && SCENE_ID_PATTERN.test(id);
}

export function validateManifest(raw: unknown, folder: string): ValidationResult {
  const fail = (reason: string): ValidationResult => ({ ok: false, error: `scene "${folder}": ${reason}` });
  if (typeof raw !== "object" || raw === null) return fail("manifest must be an object");
  const m = raw as Record<string, unknown>;

  if (!isValidSceneId(m.id)) return fail("id must be kebab-case");
  if (m.id !== folder) return fail(`id "${m.id}" must match the folder name`);

  const name = m.name as Record<string, unknown> | undefined;
  if (typeof name !== "object" || name === null || !isNonEmptyString(name.en, MAX_NAME_LENGTH)) {
    return fail(`name.en is required (max ${MAX_NAME_LENGTH} characters)`);
  }
  const names = Object.entries(name);
  if (!names.every(([, value]) => isNonEmptyString(value, MAX_NAME_LENGTH))) {
    return fail(`every name must be a non-empty string (max ${MAX_NAME_LENGTH} characters)`);
  }

  if (!isNonEmptyString(m.author)) return fail("author is required");
  if (!isNonEmptyString(m.license)) return fail("license is required (SPDX expression)");
  if (m.apiVersion !== SCENE_API_VERSION) {
    return fail(`apiVersion ${String(m.apiVersion)} is not supported (expected ${SCENE_API_VERSION})`);
  }
  if (!SCENE_RENDERERS.includes(m.renderer as SceneRenderer)) {
    return fail(`renderer must be one of ${SCENE_RENDERERS.join(", ")}`);
  }
  if (m.weatherOverlay !== undefined && typeof m.weatherOverlay !== "boolean") {
    return fail("weatherOverlay must be a boolean");
  }

  return {
    ok: true,
    manifest: {
      id: m.id,
      name: Object.fromEntries(names) as SceneManifest["name"],
      author: m.author,
      license: m.license,
      apiVersion: m.apiVersion,
      renderer: m.renderer as SceneRenderer,
      weatherOverlay: m.weatherOverlay ?? true,
    },
  };
}

function folderOf(path: string): string {
  return path.split("/").at(-2) ?? "";
}

function isSceneModule(value: unknown): value is SceneModule {
  return typeof value === "object" && value !== null && typeof (value as SceneModule).mount === "function";
}

export function buildRegistry(
  manifests: Record<string, unknown>,
  loaders: Record<string, ModuleLoader>,
): SceneRegistry {
  const errors: string[] = [];
  const loaderByFolder = new Map(Object.entries(loaders).map(([path, loader]) => [folderOf(path), loader]));
  const scenes: SceneEntry[] = [];

  for (const [path, raw] of Object.entries(manifests)) {
    const folder = folderOf(path);
    const result = validateManifest(raw, folder);
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    const loader = loaderByFolder.get(folder);
    if (loader === undefined) {
      errors.push(`scene "${folder}": index.ts is missing`);
      continue;
    }
    scenes.push({
      manifest: result.manifest,
      async load() {
        const module = (await loader()) as { default?: unknown };
        if (!isSceneModule(module.default)) {
          throw new Error(`scene "${folder}": index.ts must default-export a scene (see defineScene)`);
        }
        return module.default;
      },
    });
  }

  scenes.sort((a, b) => {
    if (a.manifest.id === DEFAULT_SCENE_ID) return -1;
    if (b.manifest.id === DEFAULT_SCENE_ID) return 1;
    return a.manifest.name.en.localeCompare(b.manifest.name.en);
  });
  return { scenes, errors };
}

/** Picks the scene name for a BCP 47 locale ("es-CL" -> "es-CL", then "es", then "en"). */
export function localizedSceneName(manifest: SceneManifest, locale: string): string {
  const normalized = locale.trim();
  const language = normalized.split(/[-_]/)[0]?.toLowerCase() ?? "";
  const exact = Object.entries(manifest.name).find(([key]) => key.toLowerCase() === normalized.toLowerCase());
  return exact?.[1] ?? manifest.name[language] ?? manifest.name.en;
}

// Las carpetas que empiezan por "_" (como la plantilla) no se publican como escenas.
const MANIFESTS = import.meta.glob<unknown>(["./*/manifest.json", "!./_*/**"], { eager: true, import: "default" });
const LOADERS = import.meta.glob(["./*/index.ts", "!./_*/**"]);

export const sceneRegistry: SceneRegistry = buildRegistry(MANIFESTS, LOADERS);
