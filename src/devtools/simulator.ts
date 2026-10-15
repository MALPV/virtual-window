import { CONDITIONS, type Condition, type EnvironmentSnapshot } from "../engine/world";
import type { WorldStore } from "../engine/world-store";
import type { SceneEntry } from "../scenes/registry";
import { createWindowSizeController, type WindowSize, type WindowSizeController } from "./window-size";
import "./simulator.css";

/**
 * Dev-only panel to preview scenes at any time of day and in any weather without waiting for it.
 * It is loaded only when import.meta.env.DEV is true, so it never ships in release builds.
 */
export interface SimulatorOptions {
  store: WorldStore;
  scenes: SceneEntry[];
  activeSceneId: () => string | null;
  selectScene: (id: string) => Promise<boolean>;
  openByDefault: boolean;
  inTauri: boolean;
}

interface SimulatorValues {
  sunElevation: number;
  sunTrack: number;
  condition: Condition;
  intensity: number;
  cloudCover: number;
  temperature: number;
  windDrift: number;
  windStrength: number;
}

const PRESETS: Record<string, Partial<SimulatorValues>> = {
  "Clear noon": { sunElevation: 60, sunTrack: 0.5, condition: "clear", cloudCover: 0.1, temperature: 24 },
  "Golden hour": { sunElevation: 4, sunTrack: 0.85, condition: "cloudy", cloudCover: 0.4, temperature: 18 },
  "Warm night": { sunElevation: -25, sunTrack: 0.5, condition: "clear", cloudCover: 0.05, temperature: 18 },
  "Windy overcast": { sunElevation: 30, condition: "overcast", cloudCover: 1, windStrength: 0.9, windDrift: -0.8 },
  "Heavy rain": { sunElevation: 20, condition: "rain", intensity: 0.9, cloudCover: 1, windStrength: 0.5, windDrift: 0.4 },
  Storm: { sunElevation: 10, condition: "storm", intensity: 1, cloudCover: 1, windStrength: 0.8, windDrift: 0.7 },
  Snow: { sunElevation: 15, condition: "snow", intensity: 0.6, cloudCover: 1, temperature: -4, windStrength: 0.2 },
  Fog: { sunElevation: 8, condition: "fog", intensity: 0.85, cloudCover: 0.9, temperature: 6 },
};

const TOGGLE_HINT = "Ctrl/Cmd + Shift + D";

const SIZE_PRESETS: Record<string, WindowSize> = {
  "Compact 220x300": { width: 220, height: 300 },
  "Default 300x400": { width: 300, height: 400 },
  "Landscape 480x320": { width: 480, height: 320 },
  "Large 600x800": { width: 600, height: 800 },
  "Panoramic 900x420": { width: 900, height: 420 },
};

function toSnapshot(values: SimulatorValues): EnvironmentSnapshot {
  return {
    sunElevation: values.sunElevation,
    sunTrack: values.sunTrack,
    locationKnown: true,
    weather: {
      condition: values.condition,
      intensity: values.intensity,
      cloudCover: values.cloudCover,
      temperature: values.temperature,
      windDrift: values.windDrift,
      windStrength: values.windStrength,
    },
  };
}

function fromSnapshot(snapshot: EnvironmentSnapshot): SimulatorValues {
  const weather = snapshot.weather;
  return {
    sunElevation: snapshot.sunElevation,
    sunTrack: snapshot.sunTrack,
    condition: weather?.condition ?? "clear",
    intensity: weather?.intensity ?? 0.5,
    cloudCover: weather?.cloudCover ?? 0.3,
    temperature: weather?.temperature ?? 15,
    windDrift: weather?.windDrift ?? 0,
    windStrength: weather?.windStrength ?? 0.2,
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(label: string, control: HTMLElement, output?: HTMLElement): HTMLLabelElement {
  const wrapper = element("label", "simulator__row");
  wrapper.append(element("span", "simulator__label", label), control);
  if (output !== undefined) wrapper.append(output);
  return wrapper;
}

function select(options: ReadonlyArray<readonly [string, string]>, value: string): HTMLSelectElement {
  const node = element("select", "simulator__control");
  for (const [optionValue, label] of options) {
    const option = element("option", undefined, label);
    option.value = optionValue;
    node.append(option);
  }
  node.value = value;
  return node;
}

export function mountSimulator(options: SimulatorOptions): void {
  const { store } = options;
  let values = fromSnapshot(store.liveSnapshot);
  let simulating = options.openByDefault;

  const panel = element("aside", "simulator");
  panel.hidden = !options.openByDefault;
  // El panel no debe iniciar el arrastre de la ventana ni abrir el menu contextual nativo.
  panel.addEventListener("mousedown", (event) => event.stopPropagation());
  panel.addEventListener("contextmenu", (event) => event.stopPropagation());

  const header = element("div", "simulator__header");
  header.append(element("strong", undefined, "Simulator"), element("span", "simulator__hint", TOGGLE_HINT));
  panel.append(header);

  const sceneSelect = select(
    options.scenes.map(({ manifest }) => [manifest.id, manifest.name.en] as const),
    options.activeSceneId() ?? "",
  );
  sceneSelect.addEventListener("change", () => {
    void options.selectScene(sceneSelect.value);
  });
  panel.append(row("Scene", sceneSelect));

  const simulateToggle = element("input", "simulator__control");
  simulateToggle.type = "checkbox";
  simulateToggle.checked = simulating;
  panel.append(row("Simulate", simulateToggle));

  const presetSelect = select([["", "Preset..."], ...Object.keys(PRESETS).map((name) => [name, name] as const)], "");
  panel.append(row("Preset", presetSelect));

  const conditionSelect = select(
    CONDITIONS.map((condition) => [condition, condition] as const),
    values.condition,
  );
  panel.append(row("Condition", conditionSelect));

  type NumericKey = Exclude<keyof SimulatorValues, "condition">;
  const sliders = new Map<NumericKey, { input: HTMLInputElement; output: HTMLOutputElement }>();
  const addSlider = (key: NumericKey, label: string, min: number, max: number, step: number) => {
    const input = element("input", "simulator__control");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const output = element("output", "simulator__value");
    sliders.set(key, { input, output });
    panel.append(row(label, input, output));
  };
  addSlider("sunElevation", "Sun altitude", -30, 90, 0.5);
  addSlider("sunTrack", "Sun x", 0, 1, 0.01);
  addSlider("intensity", "Intensity", 0, 1, 0.01);
  addSlider("cloudCover", "Cloud cover", 0, 1, 0.01);
  addSlider("temperature", "Temperature", -15, 35, 0.5);
  addSlider("windDrift", "Wind drift", -1, 1, 0.01);
  addSlider("windStrength", "Wind strength", 0, 1, 0.01);

  const render = () => {
    conditionSelect.value = values.condition;
    for (const [key, { input, output }] of sliders) {
      input.value = String(values[key]);
      output.value = values[key].toFixed(2);
    }
    const disabled = !simulating;
    conditionSelect.disabled = disabled;
    presetSelect.disabled = disabled;
    for (const { input } of sliders.values()) input.disabled = disabled;
  };

  const apply = () => {
    render();
    store.setSimulated(simulating ? toSnapshot(values) : null);
  };

  simulateToggle.addEventListener("change", () => {
    simulating = simulateToggle.checked;
    if (simulating) values = fromSnapshot(store.liveSnapshot);
    apply();
  });
  presetSelect.addEventListener("change", () => {
    const preset = PRESETS[presetSelect.value];
    if (preset !== undefined) values = { ...values, ...preset };
    presetSelect.value = "";
    apply();
  });
  conditionSelect.addEventListener("change", () => {
    values = { ...values, condition: conditionSelect.value as Condition };
    apply();
  });
  for (const [key, { input }] of sliders) {
    input.addEventListener("input", () => {
      values = { ...values, [key]: Number(input.value) };
      apply();
    });
  }

  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyD") {
      event.preventDefault();
      panel.hidden = !panel.hidden;
      sceneSelect.value = options.activeSceneId() ?? "";
    }
  });

  appendWindowSection(panel, createWindowSizeController(options.inTauri));

  document.body.append(panel);
  apply();
}

function appendWindowSection(panel: HTMLElement, controller: WindowSizeController): void {
  panel.append(element("div", "simulator__section", "Window"));

  const presetSelect = select(
    [["", "Size preset..."], ...Object.keys(SIZE_PRESETS).map((name) => [name, name] as const)],
    "",
  );
  panel.append(row("Size", presetSelect));

  const createSizeSlider = (label: string, min: number) => {
    const input = element("input", "simulator__control");
    input.type = "range";
    input.min = String(min);
    input.step = "10";
    const output = element("output", "simulator__value");
    panel.append(row(label, input, output));
    return { input, output };
  };
  const width = createSizeSlider("Width", controller.min.width);
  const height = createSizeSlider("Height", controller.min.height);

  // El maximo depende de la pantalla o del viewport, que pueden cambiar mientras el panel esta abierto.
  const render = (size: WindowSize) => {
    const max = controller.max();
    width.input.max = String(max.width);
    height.input.max = String(max.height);
    width.input.value = String(size.width);
    height.input.value = String(size.height);
    width.output.value = String(Math.round(size.width));
    height.output.value = String(Math.round(size.height));
  };

  const setFromSliders = () => {
    controller.set({ width: Number(width.input.value), height: Number(height.input.value) });
  };
  width.input.addEventListener("input", setFromSliders);
  height.input.addEventListener("input", setFromSliders);
  presetSelect.addEventListener("change", () => {
    const preset = SIZE_PRESETS[presetSelect.value];
    if (preset !== undefined) controller.set(preset);
    presetSelect.value = "";
  });

  controller.onChange(render);
  render(controller.current());
}
