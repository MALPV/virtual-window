import { resolveIncludes, SHARED_GLSL, shaderScene, writeWorldUniforms } from "../api";
import boatMarkup from "./boat.html?raw";
import fragment from "./sea.frag?raw";
import "./scene.css";

export default shaderScene({
  fragment: resolveIncludes(fragment, SHARED_GLSL),
  maxPixelRatio: 1.25,
  overlay: boatMarkup,
  setUniforms(u, world) {
    writeWorldUniforms(u, world);
  },
});
