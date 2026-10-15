import { createFrameLoop, defineScene, type Rgb, type WorldState } from "../api";
import fragmentSource from "./sea.frag?raw";
import vertexSource from "./sea.vert?raw";
import boatMarkup from "./boat.html?raw";
import "./scene.css";

// Limite de densidad de pixeles: el shader corre a pantalla completa en un widget siempre abierto.
const MAX_PIXEL_RATIO = 1.5;
const MAX_FPS = 30;
// En modo concentracion el mar se mueve mas despacio.
const FOCUS_TIME_SCALE = 0.6;

const UNIFORMS = [
  "u_resolution",
  "u_time",
  "u_parallax",
  "u_sky_top",
  "u_sky_middle",
  "u_sky_horizon",
  "u_sun_color",
  "u_deck_color",
  "u_sun_x",
  "u_sun_altitude",
  "u_sun_visibility",
  "u_stars",
  "u_cloud_deck",
  "u_wind",
  "u_rain",
] as const;

type UniformName = (typeof UNIFORMS)[number];
type Uniforms = Record<UniformName, WebGLUniformLocation | null>;

interface GlResources {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  uniforms: Uniforms;
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("Could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log ?? "unknown error"}`);
  }
  return shader;
}

function createResources(gl: WebGL2RenderingContext): GlResources {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log ?? "unknown error"}`);
  }
  const vao = gl.createVertexArray();
  const uniforms = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Uniforms;
  return { gl, program, vao, uniforms };
}

function toUnit(color: Rgb): [number, number, number] {
  return [color[0] / 255, color[1] / 255, color[2] / 255];
}

export default defineScene({
  mount(container, context) {
    const canvas = document.createElement("canvas");
    canvas.className = "open-sea__canvas depth-layer";
    container.append(canvas);
    container.insertAdjacentHTML("beforeend", boatMarkup);

    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
    // Sin WebGL2 se lanza el error: el gestor de escenas vuelve a la escena por defecto.
    if (gl === null) throw new Error("WebGL2 is not available");

    let resources: GlResources | null = createResources(gl);
    let world: WorldState = context.world;
    let elapsed = 0;
    const timeScale = context.focus ? FOCUS_TIME_SCALE : 1;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const draw = () => {
      if (resources === null) return;
      const { program, vao, uniforms: u } = resources;
      const { palette } = world;
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(u.u_resolution, canvas.width, canvas.height);
      gl.uniform1f(u.u_time, elapsed / 1000);
      gl.uniform2f(u.u_parallax, context.parallax.x, -context.parallax.y);
      gl.uniform3fv(u.u_sky_top, toUnit(palette.skyTop));
      gl.uniform3fv(u.u_sky_middle, toUnit(palette.skyMiddle));
      gl.uniform3fv(u.u_sky_horizon, toUnit(palette.skyHorizon));
      gl.uniform3fv(u.u_sun_color, toUnit(palette.sun));
      gl.uniform3fv(u.u_deck_color, toUnit(palette.cloudDeck));
      gl.uniform1f(u.u_sun_x, world.sunX);
      gl.uniform1f(u.u_sun_altitude, world.sunAltitude);
      gl.uniform1f(u.u_sun_visibility, palette.sunVisibility);
      gl.uniform1f(u.u_stars, palette.starsVisibility);
      gl.uniform1f(u.u_cloud_deck, palette.cloudDeckOpacity);
      gl.uniform1f(u.u_wind, world.windStrength);
      gl.uniform1f(u.u_rain, world.rainIntensity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = createFrameLoop(
      (_, delta) => {
        elapsed += delta * timeScale;
        draw();
      },
      { maxFps: MAX_FPS },
    );

    // Con "reducir movimiento" no hay animacion continua: solo se redibuja cuando cambia algo.
    if (context.reducedMotion) draw();
    else loop.start();

    context.onWorldChange((next) => {
      world = next;
      if (context.reducedMotion) draw();
    });
    context.onParallax(() => {
      if (context.reducedMotion) draw();
    });

    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      loop.stop();
      resources = null;
    };
    const onContextRestored = () => {
      try {
        resources = createResources(gl);
        if (context.reducedMotion) draw();
        else loop.start();
      } catch (error) {
        console.error("open-sea: could not restore WebGL resources:", error);
      }
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    return {
      unmount() {
        loop.stop();
        observer.disconnect();
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);
        if (resources !== null) {
          gl.deleteProgram(resources.program);
          gl.deleteVertexArray(resources.vao);
          resources = null;
        }
        // Libera la memoria de GPU de inmediato en lugar de esperar al recolector.
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      },
    };
  },
});
