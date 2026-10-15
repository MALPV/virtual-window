import { applyWorldDataAttributes } from "../engine/css-bridge";
import type { ParallaxTracker } from "../engine/parallax";
import type { Unsubscribe, WorldStore } from "../engine/world-store";
import type { SceneEntry } from "./registry";
import type { SceneContext, SceneInstance } from "./types";

/** Matches the opacity transition of .scene-host in frame.css, plus a safety margin. */
const CROSSFADE_MS = 1_200;
const CROSSFADE_MARGIN_MS = 300;

interface MountedScene {
  id: string;
  host: HTMLElement;
  instance: SceneInstance | void;
  cleanups: Unsubscribe[];
}

export interface ScenePreferences {
  focus: boolean;
  reducedMotion: boolean;
}

export interface SceneManagerOptions {
  stage: HTMLElement;
  root: HTMLElement;
  scenes: SceneEntry[];
  store: WorldStore;
  parallax: ParallaxTracker;
  parallaxMaxPx: number;
  preferences: ScenePreferences;
}

export class SceneManager {
  private active: MountedScene | null = null;
  private readonly leaving = new Set<MountedScene>();
  private activationToken = 0;
  private preferences: ScenePreferences;

  constructor(private readonly options: SceneManagerOptions) {
    this.preferences = { ...options.preferences };
  }

  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  /** Scene containers currently in the DOM (two during a crossfade). */
  get hosts(): HTMLElement[] {
    return [...this.leaving, ...(this.active ? [this.active] : [])].map((scene) => scene.host);
  }

  /** Remounts the active scene with a crossfade when focus or motion preferences change. */
  async updatePreferences(preferences: ScenePreferences): Promise<void> {
    const changed =
      preferences.focus !== this.preferences.focus || preferences.reducedMotion !== this.preferences.reducedMotion;
    this.preferences = { ...preferences };
    if (changed && this.active !== null) await this.activate(this.active.id, { force: true });
  }

  /**
   * Crossfades to the scene. Returns false if it does not exist, fails to load or fails to mount;
   * the current scene then stays on screen.
   */
  async activate(id: string, { force = false } = {}): Promise<boolean> {
    if (!force && this.active?.id === id) return true;
    const entry = this.options.scenes.find((scene) => scene.manifest.id === id);
    if (entry === undefined) return false;

    // Un cambio de escena mas reciente invalida las cargas pendientes.
    const token = ++this.activationToken;
    let module;
    try {
      module = await entry.load();
    } catch (error) {
      console.error(`Scene "${id}" failed to load:`, error);
      return false;
    }
    if (token !== this.activationToken) return false;

    const { stage, root, store, parallax, parallaxMaxPx } = this.options;
    const host = document.createElement("div");
    host.className = "scene-host";
    host.dataset.scene = id;
    host.dataset.state = "entering";
    const { focus, reducedMotion } = this.preferences;
    // Tambien en el contenedor: el CSS de las escenas solo puede usar selectores bajo [data-scene].
    host.dataset.focus = String(focus);
    host.dataset.motion = reducedMotion ? "reduced" : "full";
    applyWorldDataAttributes(store.world, host);
    stage.append(host);

    const cleanups: Unsubscribe[] = [];
    const track = (unsubscribe: Unsubscribe): Unsubscribe => {
      cleanups.push(unsubscribe);
      return unsubscribe;
    };
    const context: SceneContext = {
      get world() {
        return store.world;
      },
      onWorldChange: (listener) => track(store.subscribe(listener)),
      get parallax() {
        return parallax.state;
      },
      onParallax: (listener) => track(parallax.subscribe(listener)),
      parallaxMaxPx,
      reducedMotion,
      focus,
    };

    let instance: SceneInstance | void;
    try {
      instance = module.mount(host, context);
    } catch (error) {
      console.error(`Scene "${id}" failed to mount:`, error);
      cleanups.forEach((cleanup) => cleanup());
      host.remove();
      return false;
    }

    const previous = this.active;
    this.active = { id, host, instance, cleanups };
    root.dataset.weatherOverlay = entry.manifest.weatherOverlay ? "on" : "off";

    // Se fuerza un reflow para que el navegador aplique la opacidad inicial antes de la transicion.
    void host.offsetWidth;
    host.dataset.state = "active";

    if (previous !== null) {
      this.leaving.add(previous);
      window.setTimeout(() => this.unmount(previous), CROSSFADE_MS + CROSSFADE_MARGIN_MS);
    }
    return true;
  }

  private unmount(scene: MountedScene): void {
    this.leaving.delete(scene);
    try {
      scene.instance?.unmount?.();
    } catch (error) {
      console.error(`Scene "${scene.id}" failed to unmount:`, error);
    }
    scene.cleanups.forEach((cleanup) => cleanup());
    scene.host.remove();
  }
}
