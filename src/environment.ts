export const ENVIRONMENT_EVENT = "environment-updated";

const CONDITIONS = ["clear", "cloudy", "overcast", "fog", "rain", "snow", "storm"] as const;
type Condition = (typeof CONDITIONS)[number];

type Weather = {
  condition: Condition;
  intensity: number;
  cloudCover: number;
  temperature: number;
  windDrift: number;
};

export type EnvironmentSnapshot = {
  sunElevation: number;
  sunTrack: number;
  locationKnown: boolean;
  weather: Weather | null;
};

type Rgb = [number, number, number];
type SkyPalette = [Rgb, Rgb, Rgb, Rgb];

const SVG_NS = "http://www.w3.org/2000/svg";
const HORIZON_Y = 440;
const ZENITH_Y = 50;
const SUN_X_MIN = 30;
const SUN_X_MAX = 370;
const MAX_VISIBLE_ELEVATION = 70;
const STAR_COUNT = 70;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isWeather(value: unknown): value is Weather {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Record<string, unknown>;
  return (
    CONDITIONS.includes(w.condition as Condition) &&
    isFiniteNumber(w.intensity) &&
    isFiniteNumber(w.cloudCover) &&
    isFiniteNumber(w.temperature) &&
    isFiniteNumber(w.windDrift)
  );
}

export function isEnvironmentSnapshot(value: unknown): value is EnvironmentSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isFiniteNumber(s.sunElevation) &&
    isFiniteNumber(s.sunTrack) &&
    typeof s.locationKnown === "boolean" &&
    (s.weather === null || isWeather(s.weather))
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hex(color: string): Rgb {
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function css(color: Rgb): string {
  return `rgb(${color.map((c) => Math.round(c)).join(", ")})`;
}

function grayOf(color: Rgb): Rgb {
  const luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  return [luminance, luminance, luminance];
}

// Paletas del cielo (cenit, cielo medio, horizonte, base) por altura del sol en grados.
const SKY_KEYFRAMES: ReadonlyArray<[number, SkyPalette]> = [
  [-18, [hex("#070b1c"), hex("#0d1430"), hex("#18213f"), hex("#1d2847")]],
  [-8, [hex("#141f45"), hex("#2c3b6b"), hex("#6a5a7e"), hex("#8a6474")]],
  [-2, [hex("#2e4778"), hex("#6c7fa8"), hex("#e0957a"), hex("#ee8a5a")]],
  [4, [hex("#4f7ab5"), hex("#93aed0"), hex("#f1c79e"), hex("#f3ad78")]],
  [12, [hex("#5b8cc9"), hex("#8fb5dd"), hex("#d6dfe2"), hex("#f2d3ae")]],
  [30, [hex("#3d7cd0"), hex("#74a8df"), hex("#bcd6ee"), hex("#dbe9f4")]],
];

function skyPalette(elevation: number): SkyPalette {
  const first = SKY_KEYFRAMES[0];
  const last = SKY_KEYFRAMES[SKY_KEYFRAMES.length - 1];
  if (elevation <= first[0]) return first[1];
  if (elevation >= last[0]) return last[1];

  for (let i = 1; i < SKY_KEYFRAMES.length; i++) {
    const [upperElevation, upper] = SKY_KEYFRAMES[i];
    if (elevation <= upperElevation) {
      const [lowerElevation, lower] = SKY_KEYFRAMES[i - 1];
      const t = (elevation - lowerElevation) / (upperElevation - lowerElevation);
      return lower.map((color, index) => mix(color, upper[index], t)) as SkyPalette;
    }
  }
  return last[1];
}

/** How much of the sky is hidden behind a uniform cloud deck, from 0 to 1. */
function cloudDeckOpacity(weather: Weather | null): number {
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

function fogAmount(weather: Weather | null): number {
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

function precipitationOf(weather: Weather | null): "rain" | "snow" | "none" {
  if (weather === null) return "none";
  if (weather.condition === "rain" || weather.condition === "storm") return "rain";
  if (weather.condition === "snow") return "snow";
  return "none";
}

// Sin datos de clima se mantiene una nubosidad ligera neutra en vez de un cielo totalmente vacio.
const DEFAULT_CLOUD_COVER = 0.3;

const root = document.documentElement;

function createStars(container: SVGGElement): void {
  // Generador determinista: las estrellas no cambian de sitio entre arranques.
  let seed = 1337;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = document.createElementNS(SVG_NS, "circle");
    star.setAttribute("cx", (random() * 400).toFixed(1));
    star.setAttribute("cy", (random() * 380).toFixed(1));
    star.setAttribute("r", (0.4 + random() * 0.9).toFixed(2));
    star.setAttribute("fill-opacity", (0.35 + random() * 0.65).toFixed(2));
    container.appendChild(star);
  }
}

export function initEnvironment(): void {
  const stars = document.querySelector<SVGGElement>("#stars");
  if (stars !== null && stars.childElementCount === 0) createStars(stars);
}

export function applyEnvironment(snapshot: EnvironmentSnapshot): void {
  const { sunElevation: elevation, weather } = snapshot;
  const daylight = smoothstep(-10, 6, elevation);
  const cloudCover = weather?.cloudCover ?? DEFAULT_CLOUD_COVER;
  const deck = cloudDeckOpacity(weather);
  const isStorm = weather?.condition === "storm";
  const isWet = weather?.condition === "rain" || isStorm;

  const palette = skyPalette(elevation).map((color) => mix(color, grayOf(color), deck * 0.6)) as SkyPalette;
  palette.forEach((color, index) => root.style.setProperty(`--sky-${index}`, css(color)));

  const deckDay = isStorm ? hex("#5f6670") : hex("#a9b0b8");
  root.style.setProperty("--deck-color", css(mix(hex("#161a24"), deckDay, daylight)));
  root.style.setProperty("--deck-opacity", deck.toFixed(3));

  const nightCloud = hex("#2a3350");
  const warmCloud = hex("#e2a48f");
  const dayCloud = hex("#ffffff");
  let cloudColor =
    elevation < 4 ? mix(nightCloud, warmCloud, smoothstep(-8, 4, elevation)) : mix(warmCloud, dayCloud, smoothstep(4, 15, elevation));
  if (isWet) cloudColor = mix(cloudColor, hex("#6b717c"), 0.5);
  root.style.setProperty("--cloud-color", css(cloudColor));

  document.querySelectorAll<SVGGElement>(".cloud").forEach((cloud) => {
    const threshold = Number(cloud.dataset.cover ?? "0");
    const baseOpacity = Number(cloud.dataset.opacity ?? "0.5");
    const visibility = smoothstep(threshold - 0.1, threshold + 0.1, cloudCover);
    cloud.style.setProperty("opacity", (visibility * baseOpacity).toFixed(3));
  });

  const starVisibility = (1 - smoothstep(-14, -6, elevation)) * (1 - Math.max(deck, cloudCover * 0.8));
  root.style.setProperty("--stars", starVisibility.toFixed(3));

  const sun = document.querySelector<SVGGElement>("#sun");
  if (sun !== null) {
    const x = SUN_X_MIN + clamp(snapshot.sunTrack, 0, 1) * (SUN_X_MAX - SUN_X_MIN);
    const y = HORIZON_Y - (Math.min(elevation, MAX_VISIBLE_ELEVATION) / MAX_VISIBLE_ELEVATION) * (HORIZON_Y - ZENITH_Y);
    sun.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  }
  root.style.setProperty("--sun-color", css(mix(hex("#ff9a52"), hex("#fff8ea"), smoothstep(0, 20, elevation))));
  const sunVisibility = smoothstep(-8, 0, elevation) * (1 - deck * 0.9) * (1 - 0.4 * cloudCover);
  root.style.setProperty("--sun-opacity", sunVisibility.toFixed(3));

  const landBrightness = (0.25 + 0.75 * daylight) * (1 - 0.3 * deck);
  const landSaturation = (0.55 + 0.45 * daylight) * (1 - 0.3 * deck);
  root.style.setProperty("--land-brightness", landBrightness.toFixed(3));
  root.style.setProperty("--land-saturation", landSaturation.toFixed(3));

  root.style.setProperty("--fog", fogAmount(weather).toFixed(3));
  root.style.setProperty("--fog-color", css(mix(hex("#2b3242"), hex("#dfe3e8"), daylight)));

  const precipitation = precipitationOf(weather);
  const precipitationStrength = weather === null ? 0 : 0.35 + 0.65 * weather.intensity;
  root.dataset.precipitation = precipitation;
  root.dataset.storm = String(isStorm);
  root.style.setProperty("--precipitation", (precipitationStrength * (0.55 + 0.45 * daylight)).toFixed(3));
  root.style.setProperty("--glass-drops", (precipitation === "rain" ? precipitationStrength : 0).toFixed(3));
  root.style.setProperty("--wind-drift", (weather?.windDrift ?? 0).toFixed(3));

  // La escarcha empieza a aparecer bajo 1 grado y es plena a -8.
  const frost = weather === null ? 0 : clamp((1 - weather.temperature) / 9, 0, 1);
  root.style.setProperty("--frost", frost.toFixed(3));
}
