import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { clamp } from "./world";
import type { Unsubscribe } from "./world-store";

export interface ParallaxState {
  /** -1 (viewer to the left) to 1 (viewer to the right). */
  x: number;
  /** -1 (viewer above) to 1 (viewer below). */
  y: number;
}

type Listener = (state: Readonly<ParallaxState>) => void;

const CURSOR_OFFSET_EVENT = "cursor-offset";
const SMOOTHING_TIME_MS = 120;
const SETTLE_THRESHOLD = 0.0005;

function isParallaxState(value: unknown): value is ParallaxState {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
}

/**
 * Smooths the viewer position (approximated by the cursor) and publishes it as
 * --parallax-x / --parallax-y and to subscribers.
 */
export class ParallaxTracker {
  private readonly target: ParallaxState = { x: 0, y: 0 };
  private readonly current: ParallaxState = { x: 0, y: 0 };
  private readonly listeners = new Set<Listener>();
  private frameId: number | null = null;
  private lastFrameTime = 0;

  constructor(private readonly root: HTMLElement) {}

  get state(): Readonly<ParallaxState> {
    return this.current;
  }

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (isTauri() && (await this.startGlobalTracking())) return;
    this.startPointerTracking();
  }

  private setTarget(state: ParallaxState): void {
    this.target.x = clamp(state.x, -1, 1);
    this.target.y = clamp(state.y, -1, 1);
    if (this.frameId === null) this.frameId = requestAnimationFrame(this.renderFrame);
  }

  private readonly renderFrame = (time: number): void => {
    const elapsed = this.lastFrameTime === 0 ? 16 : time - this.lastFrameTime;
    this.lastFrameTime = time;
    // Suavizado exponencial basado en tiempo para que no dependa de la tasa de refresco.
    const alpha = 1 - Math.exp(-elapsed / SMOOTHING_TIME_MS);
    this.current.x += (this.target.x - this.current.x) * alpha;
    this.current.y += (this.target.y - this.current.y) * alpha;

    const settled =
      Math.abs(this.target.x - this.current.x) < SETTLE_THRESHOLD &&
      Math.abs(this.target.y - this.current.y) < SETTLE_THRESHOLD;
    if (settled) {
      this.current.x = this.target.x;
      this.current.y = this.target.y;
    }

    this.root.style.setProperty("--parallax-x", this.current.x.toFixed(4));
    this.root.style.setProperty("--parallax-y", this.current.y.toFixed(4));
    for (const listener of this.listeners) {
      try {
        listener(this.current);
      } catch (error) {
        console.error("Parallax listener failed:", error);
      }
    }

    if (settled) {
      this.frameId = null;
      this.lastFrameTime = 0;
      return;
    }
    this.frameId = requestAnimationFrame(this.renderFrame);
  };

  private async startGlobalTracking(): Promise<boolean> {
    const unlisten = await listen<unknown>(CURSOR_OFFSET_EVENT, (event) => {
      if (isParallaxState(event.payload)) this.setTarget(event.payload);
    });
    try {
      await invoke("start_cursor_tracking");
      return true;
    } catch (error) {
      unlisten();
      console.warn("Global cursor tracking unavailable, using in-window pointer:", error);
      return false;
    }
  }

  // Respaldo sin posicion global del cursor (Wayland, navegador): solo reacciona dentro de la ventana.
  private startPointerTracking(): void {
    window.addEventListener("pointermove", (event) => {
      const halfWidth = window.innerWidth / 2;
      const halfHeight = window.innerHeight / 2;
      if (halfWidth <= 0 || halfHeight <= 0) return;
      this.setTarget({
        x: (event.clientX - halfWidth) / halfWidth,
        y: (event.clientY - halfHeight) / halfHeight,
      });
    });
    document.documentElement.addEventListener("pointerleave", () => this.setTarget({ x: 0, y: 0 }));
  }
}
