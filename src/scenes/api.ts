/**
 * Public entry point for scene authors. Scenes should only import from this module,
 * so internal engine changes do not break them.
 */
export { createFrameLoop, type FrameLoop, type FrameLoopOptions } from "../engine/frame-loop";
export type { ParallaxState } from "../engine/parallax";
export {
  SCENE_API_VERSION,
  type Condition,
  type DayPhase,
  type Precipitation,
  type Rgb,
  type TemperatureBand,
  type WindDirection,
  type WindLevel,
  type WorldPalette,
  type WorldState,
} from "../engine/world";
export {
  FULLSCREEN_VERTEX_SHADER,
  resolveIncludes,
  shaderScene,
  type CachedPassOptions,
  type ShaderSceneOptions,
  type UniformWriter,
  writeWorldUniforms,
} from "./shader-scene";
export { SHARED_GLSL } from "./shared";
export type { SceneContext, SceneInstance, SceneManifest, SceneModule, Unsubscribe } from "./types";

import type { SceneModule } from "./types";

/** Identity helper that gives type checking to a scene definition. */
export function defineScene(scene: SceneModule): SceneModule {
  return scene;
}

/**
 * Scene made only of markup and CSS. The markup is bundled at build time (never user input),
 * so injecting it is safe. Inline scripts and inline style attributes are blocked by the CSP.
 */
export function htmlScene(markup: string): SceneModule {
  return defineScene({
    mount(container) {
      container.innerHTML = markup;
    },
  });
}
