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
const DEFAULT_MOVING_SCALE = 0.5;
/** Time without parallax changes after which the cached pass is refined at full resolution. */
const PARALLAX_SETTLE_MS = 200;
const INCLUDE_PATTERN = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;
const MAX_INCLUDE_DEPTH = 4;

/**
 * Replaces `#include "name.glsl"` lines with the given chunks so passes can share code.
 * Throws on a missing chunk or on includes nested too deeply (likely a cycle).
 */
export function resolveIncludes(source: string, chunks: Record<string, string>, depth = 0): string {
  if (depth > MAX_INCLUDE_DEPTH) throw new Error("GLSL includes are nested too deeply");
  return source.replace(INCLUDE_PATTERN, (_, name: string) => {
    const chunk = chunks[name];
    if (chunk === undefined) throw new Error(`Missing GLSL chunk "${name}"`);
    return resolveIncludes(chunk, chunks, depth + 1);
  });
}

export interface UniformWriter {
  float(name: string, value: number): void;
  vec2(name: string, x: number, y: number): void;
  /** Color with channels from 0 to 255, uploaded as 0..1 (still sRGB). */
  color(name: string, color: Rgb): void;
}

export interface CachedPassOptions {
  /** Expensive fragment shader, rendered into a texture only when its inputs change. */
  fragment: string;
  /** Resolution multiplier while the viewer moves. Defaults to 0.5. */
  movingScale?: number;
}

export interface ShaderSceneOptions {
  /** GLSL ES 3.0 fragment shader (#version 300 es), drawn every frame. */
  fragment: string;
  /**
   * Optional expensive pass (terrain, lighting, sky scattering). It is rendered again only when the
   * world, the parallax or the size change, and the main pass reads it as `u_cached` (sampler2D).
   */
  cached?: CachedPassOptions;
  /** Defaults to a full-screen triangle. */
  vertex?: string;
  /** Upper bound for the canvas pixel density. */
  maxPixelRatio?: number;
  maxFps?: number;
  /** Animation speed multiplier in focus mode. Defaults to 0.6. */
  focusTimeScale?: number;
  /** Optional static markup placed over the canvas (bundled at build time). */
  overlay?: string;
  /**
   * Writes the scene-specific uniforms for both passes. The helper always sets
   * u_resolution (vec2, pixels of the pass), u_time (float, seconds) and u_parallax (vec2, -1..1, y down).
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

/** A linked program with its own uniform location cache. */
class Pass {
  private readonly locations = new Map<string, WebGLUniformLocation | null>();
  readonly writer: UniformWriter;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly program: WebGLProgram,
  ) {
    this.writer = {
      float: (name, value) => gl.uniform1f(this.location(name), value),
      vec2: (name, x, y) => gl.uniform2f(this.location(name), x, y),
      color: (name, color) => gl.uniform3f(this.location(name), color[0] / 255, color[1] / 255, color[2] / 255),
    };
  }

  location(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name) ?? null;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

interface CachedTarget {
  pass: Pass;
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface GpuResources {
  main: Pass;
  cached: CachedTarget | null;
  vao: WebGLVertexArrayObject;
}

function createCachedTarget(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): CachedTarget {
  const pass = new Pass(gl, link(gl, vertexSource, fragmentSource));
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  return { pass, texture, framebuffer, width: 0, height: 0 };
}

function createResources(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  options: ShaderSceneOptions,
): GpuResources {
  return {
    main: new Pass(gl, link(gl, vertexSource, options.fragment)),
    cached: options.cached ? createCachedTarget(gl, vertexSource, options.cached.fragment) : null,
    vao: gl.createVertexArray(),
  };
}

function disposeResources(gl: WebGL2RenderingContext, resources: GpuResources): void {
  resources.main.dispose();
  if (resources.cached !== null) {
    resources.cached.pass.dispose();
    gl.deleteTexture(resources.cached.texture);
    gl.deleteFramebuffer(resources.cached.framebuffer);
  }
  gl.deleteVertexArray(resources.vao);
}

/**
 * Builds a scene from fragment shaders: canvas sizing, FPS-capped loop paused when hidden,
 * reduced motion, focus mode, cached expensive pass, WebGL context loss and GPU cleanup.
 * Throws on mount if WebGL2 is unavailable, so the app falls back to another scene.
 */
export function shaderScene(options: ShaderSceneOptions): SceneModule {
  const maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;
  const vertexSource = options.vertex ?? FULLSCREEN_VERTEX_SHADER;
  const movingScale = options.cached?.movingScale ?? DEFAULT_MOVING_SCALE;

  return {
    mount(container, context) {
      const canvas = document.createElement("canvas");
      canvas.className = "shader-scene__canvas";
      container.append(canvas);
      if (options.overlay !== undefined) container.insertAdjacentHTML("beforeend", options.overlay);

      const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
      if (gl === null) throw new Error("WebGL2 is not available");

      let resources: GpuResources | null = createResources(gl, vertexSource, options);
      let world = context.world;
      let elapsed = 0;
      let cachedDirty = true;
      let refinePending = false;
      let lastParallaxChange = Number.NEGATIVE_INFINITY;
      const timeScale = context.focus ? (options.focusTimeScale ?? DEFAULT_FOCUS_TIME_SCALE) : 1;

      const writeCommonUniforms = (pass: Pass, width: number, height: number) => {
        pass.writer.vec2("u_resolution", width, height);
        pass.writer.float("u_time", elapsed / 1000);
        pass.writer.vec2("u_parallax", context.parallax.x, context.parallax.y);
        options.setUniforms(pass.writer, world, context);
      };

      const resizeCanvas = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
        const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          cachedDirty = true;
        }
      };

      const renderCached = (target: CachedTarget, vao: WebGLVertexArrayObject, scale: number) => {
        const width = Math.max(1, Math.round(canvas.width * scale));
        const height = Math.max(1, Math.round(canvas.height * scale));
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        if (target.width !== width || target.height !== height) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
          target.width = width;
          target.height = height;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, width, height);
        gl.useProgram(target.pass.program);
        gl.bindVertexArray(vao);
        writeCommonUniforms(target.pass, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      };

      const draw = () => {
        if (resources === null) return;
        const { main, cached, vao } = resources;
        resizeCanvas();

        if (cached !== null) {
          const moving = performance.now() - lastParallaxChange < PARALLAX_SETTLE_MS;
          // Mientras el observador se mueve se calcula a menor resolucion; al detenerse se refina una vez.
          if (cachedDirty || (refinePending && !moving)) {
            renderCached(cached, vao, moving ? movingScale : 1);
            cachedDirty = false;
            refinePending = moving;
          }
        }

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(main.program);
        gl.bindVertexArray(vao);
        if (cached !== null) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, cached.texture);
          gl.uniform1i(main.location("u_cached"), 0);
        }
        writeCommonUniforms(main, canvas.width, canvas.height);
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
        cachedDirty = true;
        if (context.reducedMotion) draw();
      });
      context.onParallax(() => {
        cachedDirty = true;
        lastParallaxChange = performance.now();
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
          resources = createResources(gl, vertexSource, options);
          cachedDirty = true;
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
          if (resources !== null) disposeResources(gl, resources);
          resources = null;
          // Libera la memoria de GPU de inmediato en lugar de esperar al recolector.
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        },
      };
    },
  };
}
