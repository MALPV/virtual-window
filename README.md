# Window

A small floating window for your desktop that opens onto a living landscape. The sky follows the real sun where you are, the weather outside is your weather, and the view shifts with parallax as you move the cursor, as if you were looking through real glass.

No text, no buttons, no setup. It works anywhere in the world, on macOS, Windows and Linux.

## Features

- **Real sky.** The sun's position is computed astronomically for your location every minute: dawn, golden hour, twilight and starry nights, in both hemispheres, the tropics and polar regions.
- **Real weather.** Clouds, overcast skies, fog, rain, snow, thunderstorms, raindrops on the glass and frost on the panes below 1 °C. Rain, clouds and trees follow the wind.
- **Alive.** Drifting clouds, swaying trees, birds by day, fireflies on warm nights, chimney smoke, city lights at dusk.
- **Depth.** An architectural frame with an inner bevel, mullions and a reflective pane. The cursor stands in for your head: far things shift more than near ones.
- **Scenes.** Pick a view from the right-click menu: Open sea, Mountains and Coast, rendered in real time in 3D with physically based light, plus Alpine lake and Rooftops. Anyone can add a new one.
- **Real glass.** Raindrops bead and slide down the pane, inverting the view like tiny lenses, while the landscape behind goes slightly out of focus. Switching crossfades, and weather changes blend in over a minute and a half: nothing ever jumps.
- **Your window.** Classic, modern or industrial frame in six colors, adjustable brightness, focus mode with fewer stimuli, reduce motion, and always on top. It remembers where you left it and at what size, so it can live next to your editor or browser.
- **Light.** Built with Tauri: a native window, a few MB, animations on the GPU, paused when hidden.

## Download

Get the installer for your system from the [Releases](../../releases) page.

The builds are not code-signed yet:

- **macOS:** right-click the app and choose **Open** the first time.
- **Windows:** if SmartScreen appears, click **More info**, then **Run anyway**.
- **Linux:** use the `.AppImage` or `.deb`. On Wayland, parallax only reacts while the cursor is over the window, and "always on top" depends on your compositor.

## Usage

- Drag anywhere to move the window. Resize from its edges.
- Right-click for the menu: scene, frame style and color, brightness, focus mode, reduce motion, always on top, and close. Everything is remembered.

## Build from source

Requirements: Node.js 20+, Rust stable, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system.

```bash
npm install
npm run tauri dev     # desktop app with hot reload
npm run tauri build   # installers in src-tauri/target/release/bundle/
```

To design scenes you don't need Rust at all: `npm run dev` and open http://localhost:1420 in a browser.

## Create a scene

A scene is a folder in `src/scenes/` with a manifest and some HTML/CSS, or a `mount` function for Canvas and WebGL. The engine gives it the world as CSS variables (`--sun-altitude`, `--daylight`, `--rain-intensity`, `--wind-drift`...) and a dev simulator lets you preview any hour and weather.

Start with [docs/scene-api.md](docs/scene-api.md) and the template in `src/scenes/_template`.

## How it works

```
Rust backend (src-tauri)                 Web frontend (src)
-------------------------                ---------------------------------
location.rs  IP -> coordinates  --+
weather.rs   Open-Meteo          +-->  engine/world.ts     WorldState + default palette
solar.rs     sun position       --+     engine/css-bridge   CSS variables + data attributes
cursor.rs    global cursor  ---------> engine/parallax     smoothed viewer position
menu.rs      native menu   <--------> scenes/registry     auto-discovered scenes
                                        frame/             frame, glass, rain on the pane
```

All network access happens in Rust over HTTPS. The web view has no network access and runs under a strict Content Security Policy. Scenes are bundled at build time, never downloaded.

## Privacy

To show your sky and weather, the app looks up your approximate location from your IP address (ipapi.co, with ipwho.is as a fallback) and requests the weather for it from Open-Meteo. Coordinates are rounded to about 1 km and cached locally for 12 hours. There are no accounts, no analytics and no telemetry. Details in [PRIVACY.md](PRIVACY.md).

## Contributing

Contributions are welcome, especially new scenes. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started. Security issues: see [SECURITY.md](SECURITY.md).

## License

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.

Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Open-Meteo's free API is for non-commercial use; commercial redistributions need their own plan.
