import { invoke } from "@tauri-apps/api/core";

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowSizeController {
  readonly min: WindowSize;
  /** Largest size that fits the current screen (desktop) or viewport (browser). */
  max(): WindowSize;
  current(): WindowSize;
  set(size: WindowSize): void;
  onChange(listener: (size: WindowSize) => void): void;
}

// Debe coincidir con minWidth/minHeight de tauri.conf.json y con el CSS del modo navegador.
export const MIN_WINDOW_SIZE: WindowSize = { width: 180, height: 220 };
const DESKTOP_MAX_SIDE = 1600;
const BROWSER_MARGIN = 16;

function clampSize(size: WindowSize, max: WindowSize): WindowSize {
  return {
    width: Math.round(Math.min(Math.max(size.width, MIN_WINDOW_SIZE.width), max.width)),
    height: Math.round(Math.min(Math.max(size.height, MIN_WINDOW_SIZE.height), max.height)),
  };
}

function atLeastMin(size: WindowSize): WindowSize {
  return {
    width: Math.max(size.width, MIN_WINDOW_SIZE.width),
    height: Math.max(size.height, MIN_WINDOW_SIZE.height),
  };
}

function browserController(frame: HTMLElement): WindowSizeController {
  const max = () =>
    atLeastMin({ width: window.innerWidth - BROWSER_MARGIN, height: window.innerHeight - BROWSER_MARGIN });
  const current = () => ({ width: frame.offsetWidth, height: frame.offsetHeight });
  return {
    min: MIN_WINDOW_SIZE,
    max,
    current,
    set(size) {
      const next = clampSize(size, max());
      frame.style.setProperty("width", `${next.width}px`);
      frame.style.setProperty("height", `${next.height}px`);
    },
    onChange(listener) {
      // Cubre tanto los controles del simulador como el arrastre de la esquina redimensionable.
      new ResizeObserver(() => listener(current())).observe(frame);
    },
  };
}

function desktopController(): WindowSizeController {
  const max = () =>
    atLeastMin({
      width: Math.min(DESKTOP_MAX_SIDE, window.screen.availWidth),
      height: Math.min(DESKTOP_MAX_SIDE, window.screen.availHeight),
    });
  const current = () => ({ width: window.innerWidth, height: window.innerHeight });
  let pending: WindowSize | null = null;
  let frameId: number | null = null;

  // Un slider emite muchos eventos por segundo: se envia como mucho un cambio por fotograma.
  const flush = () => {
    frameId = null;
    if (pending === null) return;
    const size = pending;
    pending = null;
    invoke("dev_set_window_size", { width: size.width, height: size.height }).catch((error) =>
      console.error("Failed to resize window:", error),
    );
  };

  return {
    min: MIN_WINDOW_SIZE,
    max,
    current,
    set(size) {
      pending = clampSize(size, max());
      if (frameId === null) frameId = requestAnimationFrame(flush);
    },
    onChange(listener) {
      window.addEventListener("resize", () => listener(current()));
    },
  };
}

export function createWindowSizeController(inTauri: boolean): WindowSizeController {
  if (inTauri) return desktopController();
  const frame = document.querySelector<HTMLElement>(".window");
  if (frame === null) throw new Error("Missing .window element");
  return browserController(frame);
}
