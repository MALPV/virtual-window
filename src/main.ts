import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { applyEnvironment, ENVIRONMENT_EVENT, initEnvironment, isEnvironmentSnapshot } from "./environment";

type Offset = { x: number; y: number };

const CURSOR_OFFSET_EVENT = "cursor-offset";
const SMOOTHING_TIME_MS = 120;
const SETTLE_THRESHOLD = 0.0005;

const root = document.documentElement;
const appWindow = getCurrentWindow();

const target: Offset = { x: 0, y: 0 };
const current: Offset = { x: 0, y: 0 };
let frameId: number | null = null;
let lastFrameTime = 0;

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function isOffset(value: unknown): value is Offset {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
}

function applyOffset(offset: Offset): void {
  root.style.setProperty("--px", offset.x.toFixed(4));
  root.style.setProperty("--py", offset.y.toFixed(4));
}

function renderFrame(time: number): void {
  const elapsed = lastFrameTime === 0 ? 16 : time - lastFrameTime;
  lastFrameTime = time;
  // Suavizado exponencial basado en tiempo para que no dependa de la tasa de refresco.
  const alpha = 1 - Math.exp(-elapsed / SMOOTHING_TIME_MS);

  current.x += (target.x - current.x) * alpha;
  current.y += (target.y - current.y) * alpha;

  const settled =
    Math.abs(target.x - current.x) < SETTLE_THRESHOLD && Math.abs(target.y - current.y) < SETTLE_THRESHOLD;
  if (settled) {
    current.x = target.x;
    current.y = target.y;
  }
  applyOffset(current);

  if (settled) {
    frameId = null;
    lastFrameTime = 0;
    return;
  }
  frameId = requestAnimationFrame(renderFrame);
}

function setTarget(offset: Offset): void {
  target.x = clampUnit(offset.x);
  target.y = clampUnit(offset.y);
  if (frameId === null) {
    frameId = requestAnimationFrame(renderFrame);
  }
}

async function startGlobalTracking(): Promise<boolean> {
  const unlisten: UnlistenFn = await listen<unknown>(CURSOR_OFFSET_EVENT, (event) => {
    if (isOffset(event.payload)) setTarget(event.payload);
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

// Respaldo para plataformas sin posicion global del cursor (p. ej. Wayland): solo reacciona dentro de la ventana.
function startPointerTracking(): void {
  window.addEventListener("pointermove", (event) => {
    const halfWidth = window.innerWidth / 2;
    const halfHeight = window.innerHeight / 2;
    if (halfWidth <= 0 || halfHeight <= 0) return;
    setTarget({
      x: (event.clientX - halfWidth) / halfWidth,
      y: (event.clientY - halfHeight) / halfHeight,
    });
  });
  document.documentElement.addEventListener("pointerleave", () => setTarget({ x: 0, y: 0 }));
}

function setupWindowInteractions(): void {
  window.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    appWindow.startDragging().catch((error) => console.error("Failed to start dragging:", error));
  });

  window.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    invoke("show_context_menu", { locale: navigator.language, scenes: [], activeScene: "" }).catch((error) =>
      console.error("Failed to show context menu:", error),
    );
  });
}

async function startEnvironment(): Promise<void> {
  initEnvironment();
  await listen<unknown>(ENVIRONMENT_EVENT, (event) => {
    if (isEnvironmentSnapshot(event.payload)) applyEnvironment(event.payload);
  });
  try {
    const initial = await invoke<unknown>("start_environment", {
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
    });
    if (isEnvironmentSnapshot(initial)) applyEnvironment(initial);
  } catch (error) {
    console.warn("Environment updates unavailable:", error);
  }
}

async function main(): Promise<void> {
  setupWindowInteractions();
  startEnvironment().catch((error) => console.error("Failed to start environment:", error));

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const hasGlobalTracking = await startGlobalTracking();
  if (!hasGlobalTracking) startPointerTracking();
}

void main();
