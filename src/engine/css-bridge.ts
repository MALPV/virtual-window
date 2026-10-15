import type { Rgb, WorldState } from "./world";

/**
 * CSS custom properties published on :root. Part of the public scene API (see docs/scene-api.md).
 * Numbers are unitless so scenes can combine them freely with calc().
 */
export const WORLD_CSS_VARIABLES = [
  "--sun-altitude",
  "--sun-x",
  "--daylight",
  "--cloud-cover",
  "--rain-intensity",
  "--snow-intensity",
  "--fog-density",
  "--storm",
  "--wind-drift",
  "--wind-strength",
  "--temperature",
  "--sky-top",
  "--sky-middle",
  "--sky-horizon",
  "--sky-bottom",
  "--sun-color",
  "--sun-visibility",
  "--stars-visibility",
  "--cloud-color",
  "--cloud-deck-color",
  "--cloud-deck-opacity",
  "--fog-color",
  "--land-brightness",
  "--land-saturation",
  "--frost",
] as const;

export type WorldCssVariable = (typeof WORLD_CSS_VARIABLES)[number];

/** Data attributes set on :root and on the scene container. Part of the public scene API. */
export const WORLD_DATA_ATTRIBUTES = [
  "data-condition",
  "data-precipitation",
  "data-storm",
  "data-day-phase",
  "data-wind",
  "data-wind-level",
  "data-temperature",
] as const;

function rgb(color: Rgb): string {
  return `rgb(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])})`;
}

function number(value: number): string {
  return value.toFixed(4);
}

export function worldCssValues(world: WorldState): Partial<Record<WorldCssVariable, string>> {
  const { palette } = world;
  const values: Partial<Record<WorldCssVariable, string>> = {
    "--sun-altitude": number(world.sunAltitude),
    "--sun-x": number(world.sunX),
    "--daylight": number(world.daylight),
    "--cloud-cover": number(world.cloudCover),
    "--rain-intensity": number(world.rainIntensity),
    "--snow-intensity": number(world.snowIntensity),
    "--fog-density": number(world.fogDensity),
    "--storm": world.storm ? "1" : "0",
    "--wind-drift": number(world.windDrift),
    "--wind-strength": number(world.windStrength),
    "--sky-top": rgb(palette.skyTop),
    "--sky-middle": rgb(palette.skyMiddle),
    "--sky-horizon": rgb(palette.skyHorizon),
    "--sky-bottom": rgb(palette.skyBottom),
    "--sun-color": rgb(palette.sun),
    "--sun-visibility": number(palette.sunVisibility),
    "--stars-visibility": number(palette.starsVisibility),
    "--cloud-color": rgb(palette.cloud),
    "--cloud-deck-color": rgb(palette.cloudDeck),
    "--cloud-deck-opacity": number(palette.cloudDeckOpacity),
    "--fog-color": rgb(palette.fog),
    "--land-brightness": number(palette.landBrightness),
    "--land-saturation": number(palette.landSaturation),
    "--frost": number(palette.frost),
  };
  // Sin temperatura conocida la variable queda sin definir para que las escenas usen su valor de respaldo.
  if (world.temperature !== null) values["--temperature"] = number(world.temperature);
  return values;
}

export function worldDataAttributes(world: WorldState): Record<(typeof WORLD_DATA_ATTRIBUTES)[number], string> {
  return {
    "data-condition": world.condition,
    "data-precipitation": world.precipitation,
    "data-storm": String(world.storm),
    "data-day-phase": world.dayPhase,
    "data-wind": world.windDirection,
    "data-wind-level": world.windLevel,
    "data-temperature": world.temperatureBand,
  };
}

export function applyWorldToCss(world: WorldState, root: HTMLElement, sceneHost: HTMLElement): void {
  const values = worldCssValues(world);
  for (const name of WORLD_CSS_VARIABLES) {
    const value = values[name];
    if (value === undefined) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  for (const [name, value] of Object.entries(worldDataAttributes(world))) {
    root.setAttribute(name, value);
    sceneHost.setAttribute(name, value);
  }
}
