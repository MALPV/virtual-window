import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { applyWorldToCss } from "./engine/css-bridge";
import { ParallaxTracker } from "./engine/parallax";
import { loadSceneId, saveSceneId } from "./engine/preferences";
import { isEnvironmentSnapshot } from "./engine/world";
import { WorldStore } from "./engine/world-store";
import { DEFAULT_SCENE_ID, isValidSceneId, localizedSceneName, sceneRegistry } from "./scenes/registry";
import { SceneManager } from "./scenes/scene-manager";

const ENVIRONMENT_EVENT = "environment-updated";
const SCENE_SELECTED_EVENT = "scene-selected";
const FALLBACK_PARALLAX_MAX_PX = 26;

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element;
}

function readParallaxMax(root: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--parallax-max"));
  return Number.isFinite(value) ? value : FALLBACK_PARALLAX_MAX_PX;
}

async function selectScene(manager: SceneManager, id: string): Promise<boolean> {
  const activated = await manager.activate(id);
  if (activated) saveSceneId(id);
  return activated;
}

async function activateInitialScene(manager: SceneManager): Promise<void> {
  const saved = loadSceneId();
  if (saved !== null && (await manager.activate(saved))) return;
  if (await manager.activate(DEFAULT_SCENE_ID)) return;
  // Si la escena por defecto falla (p. ej. un fork sin ella), se usa la primera que funcione.
  for (const scene of sceneRegistry.scenes) {
    if (await manager.activate(scene.manifest.id)) return;
  }
  console.error("No scene could be mounted");
}

async function startEnvironment(store: WorldStore): Promise<void> {
  await listen<unknown>(ENVIRONMENT_EVENT, (event) => {
    if (isEnvironmentSnapshot(event.payload)) store.setLive(event.payload);
  });
  const initial = await invoke<unknown>("start_environment", {
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
  });
  if (isEnvironmentSnapshot(initial)) store.setLive(initial);
}

async function setupTauriInteractions(manager: SceneManager): Promise<void> {
  const appWindow = getCurrentWindow();

  window.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    appWindow.startDragging().catch((error) => console.error("Failed to start dragging:", error));
  });

  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const locale = navigator.language;
    const scenes = sceneRegistry.scenes.map(({ manifest }) => ({
      id: manifest.id,
      name: localizedSceneName(manifest, locale),
    }));
    invoke("show_context_menu", { locale, scenes, activeScene: manager.activeId ?? "" }).catch((error) =>
      console.error("Failed to show context menu:", error),
    );
  });

  await listen<unknown>(SCENE_SELECTED_EVENT, (event) => {
    const id = (event.payload as { id?: unknown } | null)?.id;
    if (isValidSceneId(id)) {
      selectScene(manager, id).catch((error) => console.error("Failed to switch scene:", error));
    }
  });
}

async function main(): Promise<void> {
  const root = document.documentElement;
  const host = requireElement("scene-host");
  const inTauri = isTauri();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.dataset.host = inTauri ? "tauri" : "browser";

  for (const error of sceneRegistry.errors) console.error("Invalid scene:", error);

  const store = new WorldStore();
  applyWorldToCss(store.world, root, host);
  store.subscribe((world) => applyWorldToCss(world, root, host));

  document.addEventListener("visibilitychange", () => {
    root.dataset.paused = String(document.hidden);
  });

  const parallax = new ParallaxTracker(root);
  const manager = new SceneManager({
    host,
    root,
    scenes: sceneRegistry.scenes,
    store,
    parallax,
    parallaxMaxPx: readParallaxMax(root),
    reducedMotion,
  });
  await activateInitialScene(manager);

  if (inTauri) {
    await setupTauriInteractions(manager);
    startEnvironment(store).catch((error) => console.warn("Environment updates unavailable:", error));
  }
  if (!reducedMotion) {
    parallax.start().catch((error) => console.error("Failed to start parallax:", error));
  }

  if (import.meta.env.DEV) {
    const { mountSimulator } = await import("./devtools/simulator");
    mountSimulator({
      store,
      scenes: sceneRegistry.scenes,
      activeSceneId: () => manager.activeId,
      selectScene: (id) => selectScene(manager, id),
      openByDefault: !inTauri,
      inTauri,
    });
  }
}

main().catch((error) => console.error("Failed to start:", error));
