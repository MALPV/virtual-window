import { resolveIncludes, SHARED_GLSL, shaderScene, writeWorldUniforms } from "../api";
import city from "./city.frag?raw";
import common from "./common.glsl?raw";
import view from "./view.frag?raw";

const CHUNKS = { ...SHARED_GLSL, "common.glsl": common };

export default shaderScene({
  fragment: resolveIncludes(view, CHUNKS),
  cached: { fragment: resolveIncludes(city, CHUNKS) },
  maxPixelRatio: 1.25,
  setUniforms(u, world, context) {
    writeWorldUniforms(u, world);
    u.float("u_focus", context.focus ? 1 : 0);
  },
});
