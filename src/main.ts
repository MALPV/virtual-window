import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { applyWorldToCss } from "./engine/css-bridge";
import { GlassRain } from "./frame/glass-rain";
import { ParallaxTracker } from "./engine/parallax";
import {
  applySettingsToDom,
  DEFAULT_SETTINGS,
  effectiveReducedMotion,
  isSettings,
  type Settings,
} from "./engine/settings";
import { isEnvironmentSnapshot } from "./engine/world";
import { WorldStore } from "./engine/world-store";
import { DEFAULT_SCENE_ID, localizedSceneName, sceneRegistry } from "./scenes/registry";
import { SceneManager } from "./scenes/scene-manager";

const ENVIRONMENT_EVENT = "environment-updated";
const SETTINGS_CHANGED_EVENT = "settings-changed";
const FALLBACK_PARALLAX_MAX_PX = 26;
const FOCUS_PARALLAX_SCALE = 0.5;

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing element #${id}`);
  return element;
}

function readParallaxMax(root: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--parallax-max"));
  return Number.isFinite(value) ? value : FALLBACK_PARALLAX_MAX_PX;
}

function parallaxScale(settings: Settings, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return settings.focus ? FOCUS_PARALLAX_SCALE : 1;
}

/** Shows the requested scene, falling back to the default one and then to any scene that works. */
async function showScene(manager: SceneManager, requested: string | null): Promise<void> {
  if (requested !== null && (await manager.activate(requested))) return;
  if (manager.activeId !== null && manager.activeId !== requested) return;
  if (await manager.activate(DEFAULT_SCENE_ID)) return;
  for (const scene of sceneRegistry.scenes) {
    if (await manager.activate(scene.manifest.id)) return;
  }
  console.error("No scene could be mounted");
}

async function loadSettings(inTauri: boolean): Promise<Settings> {
  if (!inTauri) return DEFAULT_SETTINGS;
  try {
    const settings = await invoke<unknown>("get_settings");
    if (isSettings(settings)) return settings;
    console.warn("Ignoring invalid settings from backend");
  } catch (error) {
    console.warn("Could not load settings:", error);
  }
  return DEFAULT_SETTINGS;
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

function setupTauriInteractions(manager: SceneManager): void {
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
}

async function main(): Promise<void> {
  const root = document.documentElement;
  const stage = requireElement("scene-stage");
  const inTauri = isTauri();
  const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  root.dataset.host = inTauri ? "tauri" : "browser";

  for (const error of sceneRegistry.errors) console.error("Invalid scene:", error);

  let settings = await loadSettings(inTauri);
  const reducedMotion = () => effectiveReducedMotion(settings, systemReducedMotion.matches);

  const store = new WorldStore();
  const parallax = new ParallaxTracker(root);
  const manager = new SceneManager({
    stage,
    root,
    scenes: sceneRegistry.scenes,
    store,
    parallax,
    parallaxMaxPx: readParallaxMax(root),
    preferences: { focus: settings.focus, reducedMotion: reducedMotion() },
  });

  const glassRain = new GlassRain(requireElement("glass-rain") as HTMLCanvasElement, root);
  glassRain.setPreferences({ focus: settings.focus, reducedMotion: reducedMotion() });

  applyWorldToCss(store.world, root, manager.hosts);
  glassRain.update(store.world);
  store.subscribe((world) => {
    applyWorldToCss(world, root, manager.hosts);
    glassRain.update(world);
  });

  const applySettings = async (next: Settings) => {
    const sceneChanged = next.scene !== settings.scene;
    settings = next;
    applySettingsToDom(settings, root, reducedMotion());
    parallax.setScale(parallaxScale(settings, reducedMotion()));
    glassRain.setPreferences({ focus: settings.focus, reducedMotion: reducedMotion() });
    await manager.updatePreferences({ focus: settings.focus, reducedMotion: reducedMotion() });
    if (sceneChanged) await showScene(manager, settings.scene);
  };

  applySettingsToDom(settings, root, reducedMotion());
  parallax.setScale(parallaxScale(settings, reducedMotion()));
  systemReducedMotion.addEventListener("change", () => {
    applySettings(settings).catch((error) => console.error("Failed to apply motion preference:", error));
  });
  document.addEventListener("visibilitychange", () => {
    root.dataset.paused = String(document.hidden);
  });

  await showScene(manager, settings.scene);
  parallax.start().catch((error) => console.error("Failed to start parallax:", error));

  if (inTauri) {
    setupTauriInteractions(manager);
    await listen<unknown>(SETTINGS_CHANGED_EVENT, (event) => {
      if (!isSettings(event.payload)) return;
      applySettings(event.payload).catch((error) => console.error("Failed to apply settings:", error));
    });
    startEnvironment(store).catch((error) => console.warn("Environment updates unavailable:", error));
  }

  if (import.meta.env.DEV) {
    // Acceso para el script de capturas (scripts/capture.mjs); solo existe en desarrollo.
    Object.assign(window, {
      __windowDev: {
        scenes: sceneRegistry.scenes.map(({ manifest }) => manifest.id),
        activeScene: () => manager.activeId,
        selectScene: (id: string) => applySettings({ ...settings, scene: id }),
        previewSettings: (patch: Partial<Settings>) => applySettings({ ...settings, ...patch }),
        simulate: (snapshot: unknown) => {
          if (!isEnvironmentSnapshot(snapshot)) throw new Error("Invalid snapshot");
          store.setSimulated(snapshot);
        },
        ready: true,
      },
    });
    if (new URLSearchParams(window.location.search).has("capture")) return;

    const { mountSimulator } = await import("./devtools/simulator");
    mountSimulator({
      store,
      scenes: sceneRegistry.scenes,
      activeSceneId: () => manager.activeId,
      // En la app el cambio pasa por Rust para guardarse; en el navegador se aplica directamente.
      selectScene: inTauri
        ? (id) => invoke("set_scene", { id }).then(() => undefined)
        : (id) => applySettings({ ...settings, scene: id }),
      settings: () => settings,
      previewSettings: (patch) => applySettings({ ...settings, ...patch }),
      openByDefault: !inTauri,
      inTauri,
    });
  }
}

main().catch((error) => console.error("Failed to start:", error));
