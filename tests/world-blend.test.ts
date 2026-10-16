import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveWorld, type EnvironmentSnapshot, type WeatherReport } from "../src/engine/world";
import { blendWorld, easeInOut } from "../src/engine/world-blend";
import { LIVE_TRANSITION_MS, TRANSITION_TICK_MS, WorldStore } from "../src/engine/world-store";

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

const clear = deriveWorld(snapshot());
const rain = deriveWorld(snapshot({ weather: weather({ condition: "rain", intensity: 1, cloudCover: 1 }) }));

describe("blendWorld", () => {
  it("returns the endpoints at t = 0 and t = 1", () => {
    expect(blendWorld(clear, rain, 0)).toBe(clear);
    expect(blendWorld(clear, rain, 1)).toBe(rain);
  });

  it("fades rain in instead of switching it on", () => {
    const early = blendWorld(clear, rain, 0.1);
    expect(early.precipitation).toBe("rain");
    expect(early.rainIntensity).toBeGreaterThan(0);
    expect(early.rainIntensity).toBeLessThan(rain.rainIntensity * 0.2);
  });

  it("keeps the rain visible while it fades out", () => {
    const late = blendWorld(rain, clear, 0.9);
    expect(late.precipitation).toBe("rain");
    expect(late.rainIntensity).toBeGreaterThan(0);
  });

  it("derives discrete wind values from the blended numbers", () => {
    const calm = deriveWorld(snapshot({ weather: weather({ windStrength: 0, windDrift: 0 }) }));
    const gale = deriveWorld(snapshot({ weather: weather({ windStrength: 1, windDrift: 1 }) }));
    expect(blendWorld(calm, gale, 0.1).windLevel).toBe("calm");
    expect(blendWorld(calm, gale, 0.4).windLevel).toBe("breeze");
    expect(blendWorld(calm, gale, 0.9).windLevel).toBe("strong");
  });

  it("mixes palette colors channel by channel", () => {
    const night = deriveWorld(snapshot({ sunElevation: -30 }));
    const mixed = blendWorld(night, clear, 0.5);
    for (let channel = 0; channel < 3; channel++) {
      const low = Math.min(night.palette.skyTop[channel], clear.palette.skyTop[channel]);
      const high = Math.max(night.palette.skyTop[channel], clear.palette.skyTop[channel]);
      expect(mixed.palette.skyTop[channel]).toBeGreaterThanOrEqual(low);
      expect(mixed.palette.skyTop[channel]).toBeLessThanOrEqual(high);
    }
  });

  it("uses the target temperature when either side is unknown", () => {
    const unknown = deriveWorld(snapshot({ weather: null }));
    expect(blendWorld(unknown, clear, 0.3).temperature).toBe(15);
    expect(blendWorld(clear, unknown, 0.3).temperature).toBeNull();
  });
});

describe("easeInOut", () => {
  it("is clamped and symmetric", () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });
});

describe("WorldStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies the first live snapshot instantly", () => {
    const store = new WorldStore();
    store.setLive(snapshot({ weather: weather({ condition: "rain", intensity: 1 }) }));
    expect(store.world.precipitation).toBe("rain");
    expect(store.world.rainIntensity).toBeCloseTo(1);
  });

  it("blends later live snapshots over the transition time", () => {
    const store = new WorldStore();
    store.setLive(snapshot());
    store.setLive(snapshot({ weather: weather({ condition: "rain", intensity: 1 }) }));
    expect(store.world.rainIntensity).toBe(0);

    vi.advanceTimersByTime(LIVE_TRANSITION_MS / 2);
    expect(store.world.rainIntensity).toBeGreaterThan(0.3);
    expect(store.world.rainIntensity).toBeLessThan(0.7);

    vi.advanceTimersByTime(LIVE_TRANSITION_MS / 2 + TRANSITION_TICK_MS);
    expect(store.world.rainIntensity).toBeCloseTo(1);
  });

  it("publishes on every tick while blending and stops afterwards", () => {
    const store = new WorldStore();
    store.setLive(snapshot());
    const listener = vi.fn();
    store.subscribe(listener);
    store.setLive(snapshot({ sunElevation: 40 }));

    vi.advanceTimersByTime(LIVE_TRANSITION_MS + TRANSITION_TICK_MS);
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(LIVE_TRANSITION_MS / TRANSITION_TICK_MS);

    vi.advanceTimersByTime(10 * TRANSITION_TICK_MS);
    expect(listener.mock.calls.length).toBe(calls);
  });

  it("applies simulated snapshots instantly and ignores live updates meanwhile", () => {
    const store = new WorldStore();
    store.setLive(snapshot());
    store.setSimulated(snapshot({ weather: weather({ condition: "snow", intensity: 1 }) }));
    expect(store.world.precipitation).toBe("snow");

    store.setLive(snapshot({ weather: weather({ condition: "rain", intensity: 1 }) }));
    vi.advanceTimersByTime(LIVE_TRANSITION_MS);
    expect(store.world.precipitation).toBe("snow");

    store.setSimulated(null);
    expect(store.world.precipitation).toBe("rain");
  });
});
