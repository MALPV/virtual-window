export interface FrameLoopOptions {
  /** Upper bound for render calls per second. Defaults to 30: this is an always-on widget. */
  maxFps?: number;
}

export interface FrameLoop {
  start(): void;
  stop(): void;
}

const DEFAULT_MAX_FPS = 30;

/**
 * requestAnimationFrame loop with an FPS cap that pauses automatically while the page is hidden.
 * `render` receives the current time and the time since the previous render, in milliseconds.
 */
export function createFrameLoop(
  render: (timeMs: number, deltaMs: number) => void,
  options: FrameLoopOptions = {},
): FrameLoop {
  const minInterval = 1000 / Math.max(1, options.maxFps ?? DEFAULT_MAX_FPS);
  let running = false;
  let frameId: number | null = null;
  let lastRender = 0;

  const tick = (time: number) => {
    frameId = null;
    if (!running || document.hidden) return;
    // Margen de 1 ms para no saltarse fotogramas por el jitter de rAF.
    if (lastRender === 0 || time - lastRender >= minInterval - 1) {
      const delta = lastRender === 0 ? minInterval : time - lastRender;
      lastRender = time;
      render(time, delta);
    }
    frameId = requestAnimationFrame(tick);
  };

  const onVisibilityChange = () => {
    if (!running) return;
    if (document.hidden) {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
    } else if (frameId === null) {
      lastRender = 0;
      frameId = requestAnimationFrame(tick);
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastRender = 0;
      document.addEventListener("visibilitychange", onVisibilityChange);
      frameId = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
    },
  };
}
