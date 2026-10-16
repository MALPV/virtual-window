import { resolveIncludes, SHARED_GLSL, shaderScene, writeWorldUniforms } from "../api";
import common from "./common.glsl?raw";
import scene from "./scene.frag?raw";
import view from "./view.frag?raw";

const CHUNKS = { ...SHARED_GLSL, "common.glsl": common };

export default shaderScene({
  fragment: resolveIncludes(view, CHUNKS),
  cached: { fragment: resolveIncludes(scene, CHUNKS) },
  maxPixelRatio: 1.25,
  setUniforms(u, world) {
    writeWorldUniforms(u, world);
  },
});
