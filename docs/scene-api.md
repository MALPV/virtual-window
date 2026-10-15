# Scene API (version 1)

A **scene** is what you see through the window. The engine takes care of everything else: the frame, the glass, the real sun position, the local weather, parallax and generic rain/snow on top. A scene only has to react to the world state it receives.

You can build a scene with:

- **Only HTML/SVG and CSS.** The world is published as CSS custom properties and data attributes. No JavaScript required.
- **JavaScript** (Canvas, WebGL, Three.js, PixiJS...). The world is passed to your `mount` function as plain numbers.

## Quick start

```bash
cp -r src/scenes/_template src/scenes/my-city
# edit src/scenes/my-city/manifest.json: set "id" to "my-city" and your name
# replace every "my-scene" in scene.html and scene.css with "my-city"
npm install
npm run dev
```

Open http://localhost:1420 in any browser. You don't need Rust or Tauri to design a scene: the widget shows up at its real size, can be resized from its corner, and the **simulator** panel lets you pick your scene and try any time of day or weather. In the desktop app (`npm run tauri dev`), toggle the simulator with `Ctrl/Cmd + Shift + D`.

Scenes are discovered automatically: any folder in `src/scenes/` with a `manifest.json` and an `index.ts` is a scene. Folders starting with `_` are ignored.

## Folder layout

```
src/scenes/my-city/
  manifest.json   required
  index.ts        required, default-exports the scene
  scene.html      optional, markup for HTML/CSS scenes
  scene.css       optional, styles (must be scoped, see Rules)
```

## manifest.json

| Field            | Type                                   | Notes                                                                                     |
|------------------|----------------------------------------|-------------------------------------------------------------------------------------------|
| `id`             | string                                 | Kebab-case, must match the folder name.                                                   |
| `name`           | object                                 | Display name per language code. `en` is required, e.g. `{ "en": "Rooftops", "es": "Tejados" }`. Max 48 characters. |
| `author`         | string                                 | Your name or handle.                                                                      |
| `license`        | string                                 | SPDX expression. Must be compatible with MIT OR Apache-2.0 (MIT, Apache-2.0, BSD, ISC, CC0, CC-BY-4.0 for art). |
| `apiVersion`     | number                                 | `1`.                                                                                      |
| `renderer`       | `"svg"`, `"css"`, `"canvas"` or `"webgl"` | Informational.                                                                         |
| `weatherOverlay` | boolean, default `true`                | Set to `false` if your scene draws its own rain, snow and lightning.                      |

## index.ts

HTML/CSS scene:

```ts
import { htmlScene } from "../api";
import markup from "./scene.html?raw";
import "./scene.css";

export default htmlScene(markup);
```

JavaScript scene:

```ts
import { createFrameLoop, defineScene } from "../api";

export default defineScene({
  mount(container, context) {
    const canvas = document.createElement("canvas");
    container.append(canvas);
    const loop = createFrameLoop((time, delta) => {
      // draw using context.world and context.parallax
    });
    if (!context.reducedMotion) loop.start();

    return {
      unmount() {
        loop.stop();
      },
    };
  },
});
```

Only import from `../api`. Anything else is internal and may change without notice.

## CSS contract

Set on `:root`, so they are available everywhere. Numbers are unitless: combine them with `calc()`.

### World

| Variable            | Range       | Meaning                                                    |
|---------------------|-------------|------------------------------------------------------------|
| `--sun-altitude`    | -90 to 90   | Sun degrees above the horizon (negative: below).           |
| `--sun-x`           | 0 to 1      | Horizontal sun position in the window (0 left, 1 right).   |
| `--daylight`        | 0 to 1      | 0 at night, 1 in full daylight. Smooth through twilight.   |
| `--cloud-cover`     | 0 to 1      | Fraction of the sky covered by clouds.                     |
| `--rain-intensity`  | 0 to 1      | 0 unless it rains.                                         |
| `--snow-intensity`  | 0 to 1      | 0 unless it snows.                                         |
| `--fog-density`     | 0 to 1      | Fog, haze, or reduced visibility from precipitation.       |
| `--storm`           | 0 or 1      | Thunderstorm.                                              |
| `--wind-drift`      | -1 to 1     | Horizontal wind as seen through the window (negative pushes left). |
| `--wind-strength`   | 0 to 1      | Wind strength regardless of direction.                     |
| `--temperature`     | degrees C   | **Unset when unknown**: always give a fallback, e.g. `var(--temperature, 15)`. |

### Default look

The engine suggests a realistic palette. Use it, ignore it, or derive your own colors from it.

| Variable               | Type    | Meaning                                                |
|------------------------|---------|--------------------------------------------------------|
| `--sky-top`            | color   | Sky at the zenith.                                     |
| `--sky-middle`         | color   | Sky halfway down.                                      |
| `--sky-horizon`        | color   | Sky at the horizon.                                    |
| `--sky-bottom`         | color   | Below the horizon line (glow behind the land).         |
| `--sun-color`          | color   | Warmer near the horizon.                               |
| `--sun-visibility`     | 0 to 1  | Accounts for the horizon and clouds.                   |
| `--stars-visibility`   | 0 to 1  | Clear nights only.                                     |
| `--cloud-color`        | color   | Lit cloud color for the current light.                 |
| `--cloud-deck-color`   | color   | Uniform overcast layer color.                          |
| `--cloud-deck-opacity` | 0 to 1  | How much of the sky the overcast layer hides.          |
| `--fog-color`          | color   |                                                        |
| `--land-brightness`    | 0 to 1  | Multiplier for land (works well with `filter: brightness()`). |
| `--land-saturation`    | 0 to 1  | Multiplier for land (`filter: saturate()`).            |
| `--frost`              | 0 to 1  | Used by the frame; available if you want icy details.  |

**Restyling the sky.** Don't redefine `--sky-top` in terms of itself (that is a CSS cycle). Define your own variables instead, for example:

```css
[data-scene="my-city"] .my-city {
  --my-city-sky: color-mix(in oklab, var(--sky-top) 40%, color-mix(in oklab, #1a1446, #78c4ff calc(var(--daylight) * 100%)));
}
```

See `src/scenes/rooftops` for a complete stylized example.

### Data attributes

Set on `:root` **and** on the scene container (`[data-scene="..."]`), so you can write `[data-scene="my-city"][data-wind="left"] .cloud { ... }`.

| Attribute            | Values                                                         |
|----------------------|----------------------------------------------------------------|
| `data-condition`     | `clear`, `cloudy`, `overcast`, `fog`, `rain`, `snow`, `storm`  |
| `data-precipitation` | `none`, `rain`, `snow`                                         |
| `data-storm`         | `true`, `false`                                                |
| `data-day-phase`     | `day`, `twilight`, `night`                                     |
| `data-wind`          | `left`, `right`, `none`                                        |
| `data-wind-level`    | `calm`, `breeze`, `strong`                                     |
| `data-temperature`   | `freezing` (below 0), `cold` (below 10), `mild` (below 20), `warm`, `unknown` |

### Parallax and depth

The cursor stands in for the viewer's head. Far things move more than near things relative to the frame, exactly like a real window.

| Name              | Meaning                                                    |
|-------------------|------------------------------------------------------------|
| `--parallax-x`, `--parallax-y` | Smoothed viewer position, -1 to 1.            |
| `--parallax-max`  | Shift in px for a layer at depth 1.                        |
| `.depth-layer`    | Full-size layer, oversized so its edges never show. Set `--depth` on it: 1 for the sky, about 0.3 for close objects, 0 to stay on the glass. |
| `.depth`          | Applies only the parallax shift, no sizing.                |

Both utilities set `transform`. Don't animate `transform` on the same element: put the animated element inside.

**Anchoring HTML to an SVG.** SVGs with `preserveAspectRatio="xMidYMax slice"` and a 400x600 viewBox can host absolutely positioned HTML sprites (which animate on the GPU) with container query units. See `--s` in `src/scenes/alpine-lake/scene.css`.

## JavaScript contract

```ts
interface SceneContext {
  readonly world: WorldState;                       // latest world, see src/engine/world.ts
  onWorldChange(listener): Unsubscribe;             // about once a minute, or on simulator changes
  readonly parallax: { x: number; y: number };      // latest smoothed viewer position
  onParallax(listener): Unsubscribe;                // every animation frame while the viewer moves
  readonly parallaxMaxPx: number;
  readonly reducedMotion: boolean;
}
```

`WorldState` has the same information as the CSS contract, with colors as `[r, g, b]` tuples from 0 to 255 in `world.palette`. Subscriptions made through the context are released automatically when the scene is switched. Release anything else (timers, observers, GPU resources) in `unmount`. See `src/scenes/open-sea` for a WebGL2 example.

## Rules

These keep dozens of community scenes working together. CI enforces the first two.

1. **Scope every CSS selector** with `[data-scene="your-id"]`. The CSS of all scenes shares one page.
2. **Prefix every `@keyframes`** with `your-id-`.
3. **No inline `<script>` or `style="..."` attributes.** The Content Security Policy blocks them. Use classes and CSS custom properties defined in your stylesheet.
4. **No network access and no external assets.** Bundle everything in your folder. Scenes never receive the user's location.
5. **Respect the energy budget.** This widget is open all day.
   - Animate only `transform` and `opacity` on HTML elements: the GPU handles them without repainting. Animating inside a large SVG repaints the whole SVG every frame.
   - JavaScript loops must use `createFrameLoop` (30 FPS by default, paused when hidden).
   - When `reducedMotion` is true (or under `prefers-reduced-motion`), don't run continuous animation. CSS animations are already disabled by the frame in that case.
6. **Art you didn't create** must be under a compatible license and credited in your manifest's `author` field or a `CREDITS.md` in your folder.

## Versioning

`apiVersion` changes only on breaking changes to anything documented here. Adding variables or attributes is not breaking. A pull request that bumps it must migrate every scene in this repository.
