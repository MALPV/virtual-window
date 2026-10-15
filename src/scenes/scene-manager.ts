import type { ParallaxTracker } from "../engine/parallax";
import type { Unsubscribe, WorldStore } from "../engine/world-store";
import type { SceneEntry } from "./registry";
import type { SceneContext, SceneInstance } from "./types";

interface ActiveScene {
  id: string;
  instance: SceneInstance | void;
  cleanups: Unsubscribe[];
}

export interface SceneManagerOptions {
  host: HTMLElement;
  root: HTMLElement;
  scenes: SceneEntry[];
  store: WorldStore;
  parallax: ParallaxTracker;
  parallaxMaxPx: number;
  reducedMotion: boolean;
}

export class SceneManager {
  private active: ActiveScene | null = null;
  private activationToken = 0;

  constructor(private readonly options: SceneManagerOptions) {}

  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  /** Mounts the scene. Returns false if it does not exist, fails to load or fails to mount. */
  async activate(id: string): Promise<boolean> {
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

    this.teardown();
    const { host, root, store, parallax, parallaxMaxPx, reducedMotion } = this.options;
    host.dataset.scene = id;
    root.dataset.weatherOverlay = entry.manifest.weatherOverlay ? "on" : "off";

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
    };

    try {
      const instance = module.mount(host, context);
      this.active = { id, instance, cleanups };
      return true;
    } catch (error) {
      console.error(`Scene "${id}" failed to mount:`, error);
      cleanups.forEach((cleanup) => cleanup());
      host.replaceChildren();
      delete host.dataset.scene;
      return false;
    }
  }

  private teardown(): void {
    if (this.active === null) return;
    const { id, instance, cleanups } = this.active;
    try {
      instance?.unmount?.();
    } catch (error) {
      console.error(`Scene "${id}" failed to unmount:`, error);
    }
    cleanups.forEach((cleanup) => cleanup());
    this.options.host.replaceChildren();
    delete this.options.host.dataset.scene;
    this.active = null;
  }
}
