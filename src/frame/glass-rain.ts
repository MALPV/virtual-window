import { createFrameLoop } from "../engine/frame-loop";
import { FULLSCREEN_VERTEX_SHADER, linkProgram } from "../engine/webgl";
import { mixRgb, type Rgb, type WorldState } from "../engine/world";
import fragmentSource from "./glass-rain.frag?raw";

const MAX_PIXEL_RATIO = 1.5;
const MAX_FPS = 30;
const MIN_INTENSITY = 0.001;
// En modo concentracion resbalan menos gotas: son lo que mas llama la atencion.
const FOCUS_SLIDE = 0.45;

export interface GlassRainPreferences {
  reducedMotion: boolean;
  focus: boolean;
}

interface GlResources {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  locations: Map<string, WebGLUniformLocation | null>;
}

function unit(color: Rgb): [number, number, number] {
  return [color[0] / 255, color[1] / 255, color[2] / 255];
}

/**
 * Raindrops on the window pane. Only runs while it rains; without WebGL2 it falls back to the
 * static droplets of the frame (root[data-glass-rain="fallback"]).
 */
export class GlassRain {
  private resources: GlResources | null = null;
  private failed = false;
  private world: WorldState | null = null;
  private preferences: GlassRainPreferences = { reducedMotion: false, focus: false };
  private elapsed = 0;
  private running = false;
  private readonly loop = createFrameLoop(
    (_, delta) => {
      this.elapsed += delta;
      this.draw();
    },
    { maxFps: MAX_FPS },
  );

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly root: HTMLElement,
  ) {
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.stop();
      this.resources = null;
    });
    canvas.addEventListener("webglcontextrestored", () => this.sync());
  }

  update(world: WorldState): void {
    this.world = world;
    this.sync();
  }

  setPreferences(preferences: GlassRainPreferences): void {
    this.preferences = { ...preferences };
    this.sync();
  }

  private sync(): void {
    const intensity = this.world?.rainIntensity ?? 0;
    const active = intensity > MIN_INTENSITY && !this.failed;
    this.canvas.dataset.active = String(active);
    if (!active) {
      this.stop();
      return;
    }
    if (!this.ensureResources()) return;
    // Con movimiento reducido las gotas quedan quietas: se dibuja solo cuando cambia el clima.
    if (this.preferences.reducedMotion) {
      this.stop();
      this.draw();
    } else if (!this.running) {
      this.running = true;
      this.loop.start();
    }
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    this.loop.stop();
  }

  private ensureResources(): boolean {
    if (this.resources !== null) return true;
    try {
      const gl = this.canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
      if (gl === null) throw new Error("WebGL2 is not available");
      this.resources = {
        gl,
        program: linkProgram(gl, FULLSCREEN_VERTEX_SHADER, fragmentSource),
        vao: gl.createVertexArray(),
        locations: new Map(),
      };
      return true;
    } catch (error) {
      console.warn("Rain on glass unavailable, using static droplets:", error);
      this.failed = true;
      this.canvas.dataset.active = "false";
      this.root.dataset.glassRain = "fallback";
      return false;
    }
  }

  private draw(): void {
    const resources = this.resources;
    const world = this.world;
    if (resources === null || world === null) return;
    const { gl, program, vao, locations } = resources;
    const location = (name: string) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name) ?? null;
    };

    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const { palette } = world;
    const sky = mixRgb(palette.skyMiddle, palette.skyHorizon, 0.5);
    const ground = mixRgb(palette.cloudDeck, [20, 24, 22], 0.6).map((channel) => channel * palette.landBrightness) as [
      number,
      number,
      number,
    ];

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(location("u_resolution"), width, height);
    gl.uniform1f(location("u_time"), this.elapsed / 1000);
    gl.uniform1f(location("u_intensity"), world.rainIntensity);
    gl.uniform1f(location("u_slide"), this.preferences.focus ? FOCUS_SLIDE : 1);
    gl.uniform1f(location("u_wind"), world.windDrift);
    gl.uniform1f(location("u_light"), world.daylight);
    gl.uniform3f(location("u_sky"), ...unit(sky));
    gl.uniform3f(location("u_ground"), ...unit(ground));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
