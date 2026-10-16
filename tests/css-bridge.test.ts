import { describe, expect, it } from "vitest";

import { WORLD_CSS_VARIABLES, worldCssValues, worldDataAttributes } from "../src/engine/css-bridge";
import { deriveWorld } from "../src/engine/world";

const NO_MOON = { moonElevation: -20, moonTrack: 0.5, moonIllumination: 0.5, moonWaxing: true };

const world = deriveWorld({
  ...NO_MOON,
  sunElevation: 20,
  sunTrack: 0.3,
  locationKnown: true,
  weather: { condition: "rain", intensity: 0.5, cloudCover: 0.9, temperature: 8, windDrift: 0.4, windStrength: 0.6 },
});

describe("worldCssValues", () => {
  it("publishes every documented variable", () => {
    const values = worldCssValues(world);
    for (const name of WORLD_CSS_VARIABLES) expect(values[name], name).toBeDefined();
  });

  it("formats numbers unitless and colors as rgb()", () => {
    const values = worldCssValues(world);
    expect(values["--sun-x"]).toBe("0.3000");
    expect(values["--storm"]).toBe("0");
    expect(values["--sky-top"]).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
  });

  it("leaves the temperature unset when unknown", () => {
    const unknown = deriveWorld({ ...NO_MOON, sunElevation: 20, sunTrack: 0.5, locationKnown: false, weather: null });
    expect(worldCssValues(unknown)["--temperature"]).toBeUndefined();
  });
});

describe("worldDataAttributes", () => {
  it("exposes discrete world facts for CSS selectors", () => {
    expect(worldDataAttributes(world)).toEqual({
      "data-condition": "rain",
      "data-precipitation": "rain",
      "data-storm": "false",
      "data-day-phase": "day",
      "data-wind": "right",
      "data-wind-level": "strong",
      "data-temperature": "cold",
    });
  });
});
