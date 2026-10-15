import type { ParallaxState } from "../engine/parallax";
import type { WorldState } from "../engine/world";
import type { Unsubscribe } from "../engine/world-store";

export type { Unsubscribe };

export const SCENE_RENDERERS = ["svg", "css", "canvas", "webgl"] as const;
export type SceneRenderer = (typeof SCENE_RENDERERS)[number];

/** Contents of each scene's manifest.json. */
export interface SceneManifest {
  /** Kebab-case, must match the scene folder name. */
  id: string;
  /** Display name per language code. "en" is required. */
  name: { en: string } & Record<string, string>;
  author: string;
  /** SPDX expression. Must be compatible with the project license (MIT OR Apache-2.0). */
  license: string;
  /** Scene API version the scene was written for. */
  apiVersion: number;
  renderer: SceneRenderer;
  /** Whether the engine draws its generic rain/snow/lightning over the scene. Defaults to true. */
  weatherOverlay: boolean;
}

export interface SceneContext {
  /** Latest world state. */
  readonly world: WorldState;
  /** Called on every world update (about once per minute, or on simulator changes). */
  onWorldChange(listener: (world: WorldState) => void): Unsubscribe;
  /** Latest smoothed viewer position. */
  readonly parallax: Readonly<ParallaxState>;
  /** Called on every parallax animation frame while the viewer moves. */
  onParallax(listener: (state: Readonly<ParallaxState>) => void): Unsubscribe;
  /** Maximum parallax shift in CSS pixels for a layer with depth 1. */
  readonly parallaxMaxPx: number;
  /** True when the user asked to reduce motion (in the app or the OS): avoid continuous animation. */
  readonly reducedMotion: boolean;
  /** True in focus mode: show fewer details and keep motion gentle. */
  readonly focus: boolean;
}

export interface SceneInstance {
  /** Release timers, GPU resources and listeners not registered through the context. */
  unmount?(): void;
}

export interface SceneModule {
  /**
   * Render into `container`. Subscriptions made through `context` are released automatically.
   * The scene is mounted again (with a crossfade) when `reducedMotion` or `focus` change.
   */
  mount(container: HTMLElement, context: SceneContext): SceneInstance | void;
}
