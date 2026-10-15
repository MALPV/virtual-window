/** User preferences. The desktop app persists them in Rust; this module validates and applies them. */
export const FRAME_STYLES = ["classic", "modern", "industrial"] as const;
export const FRAME_COLORS = ["ivory", "white", "oak", "walnut", "black", "sage"] as const;
export const BRIGHTNESS_LEVELS = [100, 85, 70, 55, 40] as const;

export type FrameStyle = (typeof FRAME_STYLES)[number];
export type FrameColor = (typeof FRAME_COLORS)[number];

export interface Settings {
  scene: string | null;
  frameStyle: FrameStyle;
  frameColor: FrameColor;
  brightness: number;
  focus: boolean;
  reduceMotion: boolean;
  alwaysOnTop: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  scene: null,
  frameStyle: "classic",
  frameColor: "ivory",
  brightness: 100,
  focus: false,
  reduceMotion: false,
  alwaysOnTop: true,
};

export function isSettings(value: unknown): value is Settings {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    (s.scene === null || typeof s.scene === "string") &&
    FRAME_STYLES.includes(s.frameStyle as FrameStyle) &&
    FRAME_COLORS.includes(s.frameColor as FrameColor) &&
    BRIGHTNESS_LEVELS.includes(s.brightness as (typeof BRIGHTNESS_LEVELS)[number]) &&
    typeof s.focus === "boolean" &&
    typeof s.reduceMotion === "boolean" &&
    typeof s.alwaysOnTop === "boolean"
  );
}

/** Motion is reduced if the user asked for it in the app or in the operating system. */
export function effectiveReducedMotion(settings: Settings, systemPrefersReducedMotion: boolean): boolean {
  return settings.reduceMotion || systemPrefersReducedMotion;
}

export function applySettingsToDom(settings: Settings, root: HTMLElement, reducedMotion: boolean): void {
  root.dataset.frameStyle = settings.frameStyle;
  root.dataset.frameColor = settings.frameColor;
  root.dataset.focus = String(settings.focus);
  root.dataset.motion = reducedMotion ? "reduced" : "full";
  root.style.setProperty("--brightness", (settings.brightness / 100).toFixed(2));
}
