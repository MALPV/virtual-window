import { describe, expect, it } from "vitest";

import {
  DEFAULT_SNAPSHOT,
  deriveWorld,
  isEnvironmentSnapshot,
  skyStops,
  type EnvironmentSnapshot,
  type WeatherReport,
} from "../src/engine/world";

const weather = (overrides: Partial<WeatherReport> = {}): WeatherReport => ({
  condition: "clear",
  intensity: 0,
  cloudCover: 0.1,
  temperature: 15,
  windDrift: 0,
  windStrength: 0,
  ...overrides,
});

const snapshot = (overrides: Partial<EnvironmentSnapshot> = {}): EnvironmentSnapshot => ({
  sunElevation: 30,
  sunTrack: 0.5,
  moonElevation: -20,
  moonTrack: 0.5,
  moonIllumination: 0.5,
  moonWaxing: true,
  locationKnown: true,
  weather: weather(),
  ...overrides,
});

describe("isEnvironmentSnapshot", () => {
  it("accepts valid snapshots with and without weather", () => {
    expect(isEnvironmentSnapshot(snapshot())).toBe(true);
    expect(isEnvironmentSnapshot(snapshot({ weather: null }))).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(isEnvironmentSnapshot(null)).toBe(false);
    expect(isEnvironmentSnapshot({ ...snapshot(), sunElevation: Number.NaN })).toBe(false);
    expect(isEnvironmentSnapshot({ ...snapshot(), weather: { ...weather(), condition: "hail" } })).toBe(false);
    expect(isEnvironmentSnapshot({ ...snapshot(), weather: { ...weather(), windStrength: undefined } })).toBe(false);
    expect(isEnvironmentSnapshot({ ...snapshot(), moonWaxing: "yes" })).toBe(false);
    expect(isEnvironmentSnapshot({ ...snapshot(), moonIllumination: Number.NaN })).toBe(false);
  });
});

describe("deriveWorld", () => {
  it("classifies the phase of the day from the sun altitude", () => {
    expect(deriveWorld(snapshot({ sunElevation: 40 })).dayPhase).toBe("day");
    expect(deriveWorld(snapshot({ sunElevation: -3 })).dayPhase).toBe("twilight");
    expect(deriveWorld(snapshot({ sunElevation: -30 })).dayPhase).toBe("night");
  });

  it("peaks the golden hour while the sun is low", () => {
    expect(deriveWorld(snapshot({ sunElevation: -20 })).goldenHour).toBe(0);
    expect(deriveWorld(snapshot({ sunElevation: 3 })).goldenHour).toBeCloseTo(1);
    expect(deriveWorld(snapshot({ sunElevation: 40 })).goldenHour).toBe(0);
  });

  it("lights the night with a high full moon and dims the stars", () => {
    const dark = deriveWorld(snapshot({ sunElevation: -30, weather: weather({ cloudCover: 0 }) }));
    const moonlit = deriveWorld(
      snapshot({ sunElevation: -30, moonElevation: 40, moonIllumination: 1, weather: weather({ cloudCover: 0 }) }),
    );
    expect(dark.moonlight).toBe(0);
    expect(moonlit.moonlight).toBeCloseTo(1);
    expect(moonlit.palette.starsVisibility).toBeLessThan(dark.palette.starsVisibility);
    expect(moonlit.palette.skyTop[2]).toBeGreaterThan(dark.palette.skyTop[2]);
  });

  it("gives no moonlight with a new moon, a moon below the horizon or in daylight", () => {
    expect(deriveWorld(snapshot({ sunElevation: -30, moonElevation: 40, moonIllumination: 0 })).moonlight).toBe(0);
    expect(deriveWorld(snapshot({ sunElevation: -30, moonElevation: -5, moonIllumination: 1 })).moonlight).toBe(0);
    expect(deriveWorld(snapshot({ sunElevation: 40, moonElevation: 40, moonIllumination: 1 })).moonlight).toBe(0);
  });

  it("shows stars only on clear nights", () => {
    const clearNight = deriveWorld(snapshot({ sunElevation: -30, weather: weather({ cloudCover: 0 }) }));
    const overcastNight = deriveWorld(
      snapshot({ sunElevation: -30, weather: weather({ condition: "overcast", cloudCover: 1 }) }),
    );
    const day = deriveWorld(snapshot({ sunElevation: 40, weather: weather({ cloudCover: 0 }) }));
    expect(clearNight.palette.starsVisibility).toBeCloseTo(1);
    expect(overcastNight.palette.starsVisibility).toBeLessThan(0.3);
    expect(day.palette.starsVisibility).toBe(0);
  });

  it("splits precipitation into rain and snow intensities", () => {
    const rain = deriveWorld(snapshot({ weather: weather({ condition: "rain", intensity: 1 }) }));
    expect(rain.precipitation).toBe("rain");
    expect(rain.rainIntensity).toBeCloseTo(1);
    expect(rain.snowIntensity).toBe(0);

    const snow = deriveWorld(snapshot({ weather: weather({ condition: "snow", intensity: 0 }) }));
    expect(snow.precipitation).toBe("snow");
    expect(snow.snowIntensity).toBeCloseTo(0.35);
    expect(snow.rainIntensity).toBe(0);

    const storm = deriveWorld(snapshot({ weather: weather({ condition: "storm", intensity: 1 }) }));
    expect(storm.precipitation).toBe("rain");
    expect(storm.storm).toBe(true);
  });

  it("derives wind level and direction", () => {
    const calm = deriveWorld(snapshot({ weather: weather({ windStrength: 0.1, windDrift: 0.01 }) }));
    expect(calm.windLevel).toBe("calm");
    expect(calm.windDirection).toBe("none");

    const gale = deriveWorld(snapshot({ weather: weather({ windStrength: 0.9, windDrift: -0.7 }) }));
    expect(gale.windLevel).toBe("strong");
    expect(gale.windDirection).toBe("left");
  });

  it("grows frost below one degree and bands the temperature", () => {
    expect(deriveWorld(snapshot({ weather: weather({ temperature: 5 }) })).palette.frost).toBe(0);
    expect(deriveWorld(snapshot({ weather: weather({ temperature: -8 }) })).palette.frost).toBe(1);
    expect(deriveWorld(snapshot({ weather: weather({ temperature: -8 }) })).temperatureBand).toBe("freezing");
    expect(deriveWorld(snapshot({ weather: weather({ temperature: 25 }) })).temperatureBand).toBe("warm");
  });

  it("uses neutral defaults when the weather is unknown", () => {
    const world = deriveWorld(snapshot({ weather: null }));
    expect(world.weatherKnown).toBe(false);
    expect(world.temperature).toBeNull();
    expect(world.temperatureBand).toBe("unknown");
    expect(world.precipitation).toBe("none");
    expect(world.palette.frost).toBe(0);
  });

  it("clamps out-of-range inputs", () => {
    const world = deriveWorld(snapshot({ sunTrack: 3, weather: weather({ cloudCover: 7, windDrift: -9 }) }));
    expect(world.sunX).toBe(1);
    expect(world.cloudCover).toBe(1);
    expect(world.windDrift).toBe(-1);
  });

  it("derives a valid default world", () => {
    const world = deriveWorld(DEFAULT_SNAPSHOT);
    expect(world.dayPhase).toBe("day");
    expect(world.locationKnown).toBe(false);
  });
});

describe("skyStops", () => {
  it("returns the extreme palettes outside the keyframe range", () => {
    expect(skyStops(-90)).toEqual(skyStops(-18));
    expect(skyStops(90)).toEqual(skyStops(30));
  });

  it("interpolates between keyframes", () => {
    const [top] = skyStops(-13);
    const [nightTop] = skyStops(-18);
    const [twilightTop] = skyStops(-8);
    for (let channel = 0; channel < 3; channel++) {
      const low = Math.min(nightTop[channel], twilightTop[channel]);
      const high = Math.max(nightTop[channel], twilightTop[channel]);
      expect(top[channel]).toBeGreaterThanOrEqual(low);
      expect(top[channel]).toBeLessThanOrEqual(high);
    }
  });
});
