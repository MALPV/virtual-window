import atmosphere from "./atmosphere.glsl?raw";
import cache from "./cache.glsl?raw";
import noise from "./noise.glsl?raw";
import ocean from "./ocean.glsl?raw";
import sky from "./sky.glsl?raw";
import terrain from "./terrain.glsl?raw";
import uniforms from "./uniforms.glsl?raw";
import windowOptics from "./window.glsl?raw";

/**
 * GLSL chunks shared by the realistic scenes. Include them with `#include "noise.glsl"` and
 * resolveIncludes(source, { ...SHARED_GLSL, ...yourChunks }). Order: uniforms, noise, then the rest.
 */
export const SHARED_GLSL: Readonly<Record<string, string>> = {
  "uniforms.glsl": uniforms,
  "noise.glsl": noise,
  "window.glsl": windowOptics,
  "atmosphere.glsl": atmosphere,
  "sky.glsl": sky,
  "cache.glsl": cache,
  "ocean.glsl": ocean,
  "terrain.glsl": terrain,
};
