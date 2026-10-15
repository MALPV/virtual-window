/**
 * World model shared by every scene. This is part of the public scene API:
 * any breaking change here requires bumping SCENE_API_VERSION.
 */
export const SCENE_API_VERSION = 1;

export const CONDITIONS = ["clear", "cloudy", "overcast", "fog", "rain", "snow", "storm"] as const;
export type Condition = (typeof CONDITIONS)[number];

export type Precipitation = "none" | "rain" | "snow";
export type DayPhase = "night" | "twilight" | "day";
export type WindLevel = "calm" | "breeze" | "strong";
export type WindDirection = "left" | "right" | "none";
export type TemperatureBand = "freezing" | "cold" | "mild" | "warm" | "unknown";

/** RGB color with channels from 0 to 255. */
export type Rgb = readonly [number, number, number];

/** Weather as reported by the backend. */
export interface WeatherReport {
  condition: Condition;
  intensity: number;
  cloudCover: number;
  temperature: number;
  windDrift: number;
  windStrength: number;
}

/** Raw environment as emitted by the backend (or produced by the dev simulator). */
export interface EnvironmentSnapshot {
  sunElevation: number;
  sunTrack: number;
  locationKnown: boolean;
  weather: WeatherReport | null;
}

/** Default look suggested by the engine. Scenes may ignore or override any of it. */
export interface WorldPalette {
  skyTop: Rgb;
  skyMiddle: Rgb;
  skyHorizon: Rgb;
  skyBottom: Rgb;
  sun: Rgb;
  cloud: Rgb;
  cloudDeck: Rgb;
  fog: Rgb;
  /** 0..1 */
  sunVisibility: number;
  /** 0..1 */
  starsVisibility: number;
  /** 0..1: how much of the sky is hidden behind a uniform cloud layer. */
  cloudDeckOpacity: number;
  /** Multiplier for land brightness (CSS filter friendly). */
  landBrightness: number;
  /** Multiplier for land saturation (CSS filter friendly). */
  landSaturation: number;
  /** 0..1: frost on the glass. */
  frost: number;
}

export interface WorldState {
  /** Degrees above the horizon (negative below). */
  sunAltitude: number;
  /** Horizontal sun position in the window, 0 (left) to 1 (right). */
  sunX: number;
  /** 0 (night) to 1 (full day). */
  daylight: number;
  dayPhase: DayPhase;
  condition: Condition;
  /** 0..1 */
  cloudCover: number;
  precipitation: Precipitation;
  /** 0..1, zero unless it rains. */
  rainIntensity: number;
  /** 0..1, zero unless it snows. */
  snowIntensity: number;
  /** 0..1 */
  fogDensity: number;
  storm: boolean;
  /** -1 (pushes left) to 1 (pushes right), as seen through the window. */
  windDrift: number;
  /** 0 (calm) to 1 (strong). */
  windStrength: number;
  windLevel: WindLevel;
  windDirection: WindDirection;
  /** Degrees Celsius, null when unknown. */
  temperature: number | null;
  temperatureBand: TemperatureBand;
  weatherKnown: boolean;
  locationKnown: boolean;
  palette: WorldPalette;
}

/** Golden afternoon shown until the first real snapshot arrives. */
export const DEFAULT_SNAPSHOT: EnvironmentSnapshot = {
  sunElevation: 12,
  sunTrack: 0.72,
  locationKnown: false,
  weather: null,
};

// Sin datos de clima se usa una nubosidad ligera neutra en vez de un cielo vacio.
const UNKNOWN_WEATHER_CLOUD_COVER = 0.3;
const WIND_DIRECTION_THRESHOLD = 0.05;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isWeatherReport(value: unknown): value is WeatherReport {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Record<string, unknown>;
  return (
    CONDITIONS.includes(w.condition as Condition) &&
    isFiniteNumber(w.intensity) &&
    isFiniteNumber(w.cloudCover) &&
    isFiniteNumber(w.temperature) &&
    isFiniteNumber(w.windDrift) &&
    isFiniteNumber(w.windStrength)
  );
}

export function isEnvironmentSnapshot(value: unknown): value is EnvironmentSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isFiniteNumber(s.sunElevation) &&
    isFiniteNumber(s.sunTrack) &&
    typeof s.locationKnown === "boolean" &&
    (s.weather === null || isWeatherReport(s.weather))
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hexToRgb(color: string): Rgb {
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function grayOf(color: Rgb): Rgb {
  const luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  return [luminance, luminance, luminance];
}

type SkyStops = readonly [Rgb, Rgb, Rgb, Rgb];

// Paletas del cielo (cenit, medio, horizonte, base) por altura del sol en grados.
const SKY_KEYFRAMES: ReadonlyArray<readonly [number, SkyStops]> = [
  [-18, [hexToRgb("#070b1c"), hexToRgb("#0d1430"), hexToRgb("#18213f"), hexToRgb("#1d2847")]],
  [-8, [hexToRgb("#141f45"), hexToRgb("#2c3b6b"), hexToRgb("#6a5a7e"), hexToRgb("#8a6474")]],
  [-2, [hexToRgb("#2e4778"), hexToRgb("#6c7fa8"), hexToRgb("#e0957a"), hexToRgb("#ee8a5a")]],
  [4, [hexToRgb("#4f7ab5"), hexToRgb("#93aed0"), hexToRgb("#f1c79e"), hexToRgb("#f3ad78")]],
  [12, [hexToRgb("#5b8cc9"), hexToRgb("#8fb5dd"), hexToRgb("#d6dfe2"), hexToRgb("#f2d3ae")]],
  [30, [hexToRgb("#3d7cd0"), hexToRgb("#74a8df"), hexToRgb("#bcd6ee"), hexToRgb("#dbe9f4")]],
];

export function skyStops(elevation: number): SkyStops {
  const first = SKY_KEYFRAMES[0];
  const last = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
  if (elevation <= first[0]) return first[1];
  if (elevation >= last[0]) return last[1];

  for (let i = 1; i < SKY_KEYFRAMES.length; i++) {
    const [upperElevation, upper] = SKY_KEYFRAMES[i];
    if (elevation <= upperElevation) {
      const [lowerElevation, lower] = SKY_KEYFRAMES[i - 1];
      const t = (elevation - lowerElevation) / (upperElevation - lowerElevation);
      return [
        mixRgb(lower[0], upper[0], t),
        mixRgb(lower[1], upper[1], t),
        mixRgb(lower[2], upper[2], t),
        mixRgb(lower[3], upper[3], t),
      ];
    }
  }
  return last[1];
}

function cloudDeckOpacity(weather: WeatherReport | null): number {
  if (weather === null) return 0;
  switch (weather.condition) {
    case "clear":
      return 0;
    case "cloudy":
      return 0.25 * weather.cloudCover;
    case "overcast":
      return 0.75;
    case "fog":
      return 0.5;
    case "rain":
      return 0.65 + 0.2 * weather.intensity;
    case "snow":
      return 0.75;
    case "storm":
      return 0.9;
  }
}

function fogDensity(weather: WeatherReport | null): number {
  if (weather === null) return 0;
  switch (weather.condition) {
    case "fog":
      return weather.intensity;
    case "rain":
      return 0.15 + 0.25 * weather.intensity;
    case "snow":
      return 0.2 + 0.3 * weather.intensity;
    case "storm":
      return 0.3;
    default:
      return 0;
  }
}

function precipitationOf(weather: WeatherReport | null): Precipitation {
  if (weather === null) return "none";
  if (weather.condition === "rain" || weather.condition === "storm") return "rain";
  if (weather.condition === "snow") return "snow";
  return "none";
}

function dayPhaseOf(elevation: number): DayPhase {
  if (elevation >= 6) return "day";
  if (elevation <= -12) return "night";
  return "twilight";
}

function windLevelOf(strength: number): WindLevel {
  if (strength < 0.2) return "calm";
  if (strength < 0.55) return "breeze";
  return "strong";
}

function windDirectionOf(drift: number): WindDirection {
  if (drift > WIND_DIRECTION_THRESHOLD) return "right";
  if (drift < -WIND_DIRECTION_THRESHOLD) return "left";
  return "none";
}

function temperatureBandOf(temperature: number | null): TemperatureBand {
  if (temperature === null) return "unknown";
  if (temperature < 0) return "freezing";
  if (temperature < 10) return "cold";
  if (temperature < 20) return "mild";
  return "warm";
}

function cloudColor(elevation: number, wet: boolean): Rgb {
  const night = hexToRgb("#2a3350");
  const warm = hexToRgb("#e2a48f");
  const day = hexToRgb("#ffffff");
  const base =
    elevation < 4 ? mixRgb(night, warm, smoothstep(-8, 4, elevation)) : mixRgb(warm, day, smoothstep(4, 15, elevation));
  return wet ? mixRgb(base, hexToRgb("#6b717c"), 0.5) : base;
}

export function deriveWorld(snapshot: EnvironmentSnapshot): WorldState {
  const { sunElevation: elevation, weather } = snapshot;
  const daylight = smoothstep(-10, 6, elevation);
  const cloudCover = clamp(weather?.cloudCover ?? UNKNOWN_WEATHER_CLOUD_COVER, 0, 1);
  const deck = cloudDeckOpacity(weather);
  const precipitation = precipitationOf(weather);
  const strength = weather === null ? 0 : 0.35 + 0.65 * clamp(weather.intensity, 0, 1);
  const storm = weather?.condition === "storm";
  const windDrift = clamp(weather?.windDrift ?? 0, -1, 1);
  const windStrength = clamp(weather?.windStrength ?? 0, 0, 1);
  const temperature = weather?.temperature ?? null;

  const [skyTop, skyMiddle, skyHorizon, skyBottom] = skyStops(elevation).map((color) =>
    mixRgb(color, grayOf(color), deck * 0.6),
  );
  const deckDay = storm ? hexToRgb("#5f6670") : hexToRgb("#a9b0b8");

  return {
    sunAltitude: elevation,
    sunX: clamp(snapshot.sunTrack, 0, 1),
    daylight,
    dayPhase: dayPhaseOf(elevation),
    condition: weather?.condition ?? "clear",
    cloudCover,
    precipitation,
    rainIntensity: precipitation === "rain" ? strength : 0,
    snowIntensity: precipitation === "snow" ? strength : 0,
    fogDensity: fogDensity(weather),
    storm,
    windDrift,
    windStrength,
    windLevel: windLevelOf(windStrength),
    windDirection: windDirectionOf(windDrift),
    temperature,
    temperatureBand: temperatureBandOf(temperature),
    weatherKnown: weather !== null,
    locationKnown: snapshot.locationKnown,
    palette: {
      skyTop,
      skyMiddle,
      skyHorizon,
      skyBottom,
      sun: mixRgb(hexToRgb("#ff9a52"), hexToRgb("#fff8ea"), smoothstep(0, 20, elevation)),
      cloud: cloudColor(elevation, precipitation === "rain"),
      cloudDeck: mixRgb(hexToRgb("#161a24"), deckDay, daylight),
      fog: mixRgb(hexToRgb("#2b3242"), hexToRgb("#dfe3e8"), daylight),
      sunVisibility: smoothstep(-8, 0, elevation) * (1 - deck * 0.9) * (1 - 0.4 * cloudCover),
      starsVisibility: (1 - smoothstep(-14, -6, elevation)) * (1 - Math.max(deck, cloudCover * 0.8)),
      cloudDeckOpacity: deck,
      landBrightness: (0.25 + 0.75 * daylight) * (1 - 0.3 * deck),
      landSaturation: (0.55 + 0.45 * daylight) * (1 - 0.3 * deck),
      // La escarcha empieza a aparecer bajo 1 grado y es plena a -8.
      frost: temperature === null ? 0 : clamp((1 - temperature) / 9, 0, 1),
    },
  };
}
