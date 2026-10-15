# Contributing

Thanks for helping. There are two kinds of contributions, and they need different tools:

| You want to...                         | You need                       | Start with                         |
|----------------------------------------|--------------------------------|------------------------------------|
| Create or improve a **scene**          | Node.js 20+ and a browser      | [docs/scene-api.md](docs/scene-api.md) |
| Work on the **engine, frame or backend** | Node.js 20+, Rust stable, [Tauri prerequisites](https://tauri.app/start/prerequisites/) | This file |

## Setup

```bash
npm install
npm run dev          # browser preview at http://localhost:1420 (scenes, frame, simulator)
npm run tauri dev    # the real desktop app
```

## Project layout

```
src/
  engine/       world model, CSS bridge, parallax, frame loop (no scene-specific code)
  frame/        window frame, glass and generic weather overlay
  scenes/       one folder per scene, plus api.ts (the only module scenes may import)
  devtools/     time and weather simulator (dev builds only)
src-tauri/src/
  solar.rs      sun position
  location.rs   IP geolocation with cache
  weather.rs    Open-Meteo client and WMO code mapping
  environment.rs  scheduling, retries, snapshot events
  cursor.rs     global cursor tracking for parallax
  menu.rs       native context menu
tests/          frontend tests (Vitest)
docs/           scene API
```

## Checks

Run before opening a pull request. CI runs the same on macOS, Windows and Linux.

```bash
npm run check                       # typecheck + frontend tests
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The frontend tests also verify that every scene manifest is valid and that every scene's CSS is scoped, so a scene cannot break another.

## Guidelines

- **Scenes** follow the rules in [docs/scene-api.md](docs/scene-api.md#rules), including the energy budget. Attach a screenshot or short recording at day, at night and in rain (the simulator makes this quick).
- **Engine changes** that affect the scene contract are API changes: update `docs/scene-api.md`, and if they are breaking, bump `SCENE_API_VERSION` and migrate every scene in the same pull request.
- **Security.** The web view must stay without network access and under the current CSP. New network calls belong in Rust, over HTTPS, with validated responses. Don't add Tauri permissions unless they are strictly needed.
- **Privacy.** Never send the location anywhere other than the weather provider, and never to scenes. Never log precise coordinates.
- **Tests.** New logic comes with tests: Rust unit tests next to the code, frontend tests in `tests/`.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(scenes): ...`, `fix(engine): ...`).

## Releases

Maintainers bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, then push a tag such as `v0.2.0`. The release workflow builds installers for every platform into a draft GitHub release for review. Code signing can be added through the `tauri-action` signing secrets when certificates are available.
