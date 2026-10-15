import { createFrameLoop } from "../engine/frame-loop";
import type { Rgb, WorldState } from "../engine/world";
import type { SceneContext, SceneModule } from "./types";

/** Full-screen triangle without vertex buffers. */
export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 positions[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}
`;

const DEFAULT_MAX_PIXEL_RATIO = 1.5;
const DEFAULT_MAX_FPS = 30;
const DEFAULT_FOCUS_TIME_SCALE = 0.6;

export interface UniformWriter {
  float(name: string, value: number): void;
  vec2(name: string, x: number, y: number): void;
  /** Color with channels from 0 to 255, uploaded as 0..1 (still sRGB). */
  color(name: string, color: Rgb): void;
}

export interface ShaderSceneOptions {
  /** GLSL ES 3.0 fragment shader (#version 300 es). */
  fragment: string;
  /** Defaults to a full-screen triangle. */
  vertex?: string;
  /** Upper bound for the canvas pixel density. The shader runs for every pixel at up to 30 FPS. */
  maxPixelRatio?: number;
  maxFps?: number;
  /** Animation speed multiplier in focus mode. Defaults to 0.6. */
  focusTimeScale?: number;
  /** Optional static markup placed over the canvas (bundled at build time). */
  overlay?: string;
  /**
   * Writes the scene-specific uniforms. The helper always sets
   * u_resolution (vec2, pixels), u_time (float, seconds) and u_parallax (vec2, -1..1, y down).
   */
  setUniforms(uniforms: UniformWriter, world: WorldState, context: SceneContext): void;
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

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
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
  return program;
}

/**
 * Builds a scene from a fragment shader: canvas sizing, FPS-capped loop paused when hidden,
 * reduced motion, focus mode, WebGL context loss and GPU cleanup are handled for you.
 * Throws on mount if WebGL2 is unavailable, so the app falls back to another scene.
 */
export function shaderScene(options: ShaderSceneOptions): SceneModule {
  const maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;
  const vertexSource = options.vertex ?? FULLSCREEN_VERTEX_SHADER;

  return {
    mount(container, context) {
      const canvas = document.createElement("canvas");
      canvas.className = "shader-scene__canvas";
      container.append(canvas);
      if (options.overlay !== undefined) container.insertAdjacentHTML("beforeend", options.overlay);

      const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
      if (gl === null) throw new Error("WebGL2 is not available");

      let program: WebGLProgram | null = link(gl, vertexSource, options.fragment);
      let vao: WebGLVertexArrayObject | null = gl.createVertexArray();
      let locations = new Map<string, WebGLUniformLocation | null>();
      let world = context.world;
      let elapsed = 0;
      const timeScale = context.focus ? (options.focusTimeScale ?? DEFAULT_FOCUS_TIME_SCALE) : 1;

      const location = (name: string) => {
        if (program === null) return null;
        if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
        return locations.get(name) ?? null;
      };
      const writer: UniformWriter = {
        float: (name, value) => gl.uniform1f(location(name), value),
        vec2: (name, x, y) => gl.uniform2f(location(name), x, y),
        color: (name, color) => gl.uniform3f(location(name), color[0] / 255, color[1] / 255, color[2] / 255),
      };

      const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
        const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      };

      const draw = () => {
        if (program === null) return;
        resize();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        writer.vec2("u_resolution", canvas.width, canvas.height);
        writer.float("u_time", elapsed / 1000);
        writer.vec2("u_parallax", context.parallax.x, context.parallax.y);
        options.setUniforms(writer, world, context);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };

      const loop = createFrameLoop(
        (_, delta) => {
          elapsed += delta * timeScale;
          draw();
        },
        { maxFps: options.maxFps ?? DEFAULT_MAX_FPS },
      );

      // Con movimiento reducido no hay animacion continua: solo se redibuja cuando cambia algo.
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

      const release = () => {
        if (program !== null) gl.deleteProgram(program);
        if (vao !== null) gl.deleteVertexArray(vao);
        program = null;
        vao = null;
        locations = new Map();
      };
      const onContextLost = (event: Event) => {
        event.preventDefault();
        loop.stop();
        program = null;
        vao = null;
        locations = new Map();
      };
      const onContextRestored = () => {
        try {
          program = link(gl, vertexSource, options.fragment);
          vao = gl.createVertexArray();
          if (context.reducedMotion) draw();
          else loop.start();
        } catch (error) {
          console.error("Could not restore WebGL resources:", error);
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
          release();
          // Libera la memoria de GPU de inmediato en lugar de esperar al recolector.
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        },
      };
    },
  };
}
