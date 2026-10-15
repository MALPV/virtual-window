import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, effectiveReducedMotion, isSettings } from "../src/engine/settings";

describe("isSettings", () => {
  it("accepts the defaults and a customized value", () => {
    expect(isSettings(DEFAULT_SETTINGS)).toBe(true);
    expect(
      isSettings({ ...DEFAULT_SETTINGS, scene: "rooftops", frameStyle: "industrial", frameColor: "walnut", brightness: 55 }),
    ).toBe(true);
  });

  it.each([
    ["unknown frame style", { frameStyle: "gothic" }],
    ["unknown frame color", { frameColor: "purple" }],
    ["brightness outside the levels", { brightness: 63 }],
    ["non boolean focus", { focus: "yes" }],
    ["numeric scene", { scene: 3 }],
  ])("rejects %s", (_, patch) => {
    expect(isSettings({ ...DEFAULT_SETTINGS, ...patch })).toBe(false);
  });

  it("rejects non objects", () => {
    expect(isSettings(null)).toBe(false);
    expect(isSettings("settings")).toBe(false);
  });
});

describe("effectiveReducedMotion", () => {
  it("is on when either the app or the system asks for it", () => {
    expect(effectiveReducedMotion(DEFAULT_SETTINGS, false)).toBe(false);
    expect(effectiveReducedMotion(DEFAULT_SETTINGS, true)).toBe(true);
    expect(effectiveReducedMotion({ ...DEFAULT_SETTINGS, reduceMotion: true }, false)).toBe(true);
  });
});
