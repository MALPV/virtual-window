// Genera las imagenes del README en docs/media. Uso: npm run media
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { createServer } from "vite";

import { PRESETS } from "./capture.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MEDIA = join(ROOT, "docs", "media");
const FRAMES = join(MEDIA, ".frames");
const SETTLE_MS = 2500;
const JPEG_QUALITY = 86;
const GIF_WIDTH = 300;

const DEFAULT_FRAME = { frameStyle: "classic", frameColor: "ivory" };

const GALLERY = [
  { scene: "open-sea", preset: "golden" },
  { scene: "mountains", preset: "noon" },
  { scene: "coast", preset: "noon" },
  { scene: "alpine-lake", preset: "golden" },
  { scene: "forest", preset: "golden" },
  { scene: "dunes", preset: "noon" },
  { scene: "rooftops", preset: "night" },
];

const WEATHER = ["noon", "golden", "moon", "rain", "snow", "fog"].map((preset) => ({ scene: "coast", preset }));

const FRAME_STYLES = [
  { frameStyle: "classic", frameColor: "ivory", label: "Classic, ivory" },
  { frameStyle: "modern", frameColor: "black", label: "Modern, black" },
  { frameStyle: "industrial", frameColor: "oak", label: "Industrial, oak" },
  { frameStyle: "classic", frameColor: "sage", label: "Classic, sage" },
];

const ANIMATIONS = [
  { file: "alive.gif", scene: "open-sea", snapshot: PRESETS.golden, frames: 40, cursor: "still" },
  { file: "rain.gif", scene: "open-sea", snapshot: PRESETS.rain, frames: 40, cursor: "still" },
  { file: "parallax.gif", scene: "coast", snapshot: PRESETS.golden, frames: 40, cursor: "sweep" },
];

async function apply(page, scene, snapshot, frame = DEFAULT_FRAME) {
  await page.evaluate(
    async ({ scene, snapshot, frame }) => {
      await window.__windowDev.previewSettings(frame);
      await window.__windowDev.selectScene(scene);
      window.__windowDev.simulate(snapshot);
    },
    { scene, snapshot, frame },
  );
  await page.waitForTimeout(SETTLE_MS);
}

async function shoot(page, { scene, preset, frame }, path) {
  await apply(page, scene, PRESETS[preset], frame);
  await page.locator(".window").screenshot({ path, type: "jpeg", quality: JPEG_QUALITY });
}

const image = async (path) => `data:image/jpeg;base64,${(await readFile(path)).toString("base64")}`;

async function compose(browser, html, width, height, path) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`);
  await page.screenshot({ path, type: "jpeg", quality: JPEG_QUALITY });
  await page.close();
}

const BACKDROP = "background: radial-gradient(120% 140% at 50% 0%, #2b3140 0%, #14161c 60%, #0d0e12 100%);";

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Resaltado minimo para la maqueta del editor: palabras clave, cadenas, numeros y comentarios.
function highlight(line) {
  const comment = line.indexOf("//");
  const code = comment >= 0 ? line.slice(0, comment) : line;
  const rest = comment >= 0 ? `<span class="c">${escapeHtml(line.slice(comment))}</span>` : "";
  const html = escapeHtml(code)
    .replace(/("[^"]*")/g, '<span class="s">$1</span>')
    .replace(/\b(export|function|const|let|return|if|else|import|from|type|interface|new)\b/g, '<span class="k">$1</span>')
    .replace(/\b(\d+(\.\d+)?)\b/g, '<span class="n">$1</span>');
  return html + rest;
}

async function desktopImage(browser, windowShot) {
  const source = await readFile(join(ROOT, "src", "engine", "world-store.ts"), "utf8");
  const start = source.indexOf("export class WorldStore");
  const lines = source.slice(start).split("\n").slice(0, 34);
  const code = lines.map((line, index) => `<div><i>${index + 18}</i>${highlight(line) || " "}</div>`).join("");
  const html = `<style>
    body{margin:0;width:1600px;height:900px;overflow:hidden;font-family:-apple-system,system-ui,sans-serif;
      background:radial-gradient(90% 120% at 15% 10%,#3b4a7a 0%,#1f2440 45%,#0f1020 100%)}
    .menubar{height:28px;background:rgba(20,22,34,.55);backdrop-filter:blur(20px);color:#d8dbe6;font-size:13px;display:flex;align-items:center;gap:22px;padding:0 18px}
    .editor{position:absolute;left:70px;top:80px;width:980px;height:740px;border-radius:12px;overflow:hidden;
      background:#1b1d26;box-shadow:0 40px 90px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.06)}
    .titlebar{height:38px;background:#20222d;display:flex;align-items:center;gap:8px;padding:0 14px;color:#8a8fa3;font-size:12.5px}
    .dot{width:12px;height:12px;border-radius:50%}
    .tab{margin-left:18px;padding:6px 14px;background:#1b1d26;border-radius:6px 6px 0 0;color:#cfd3e0}
    .side{position:absolute;top:38px;bottom:0;width:190px;background:#191b23;color:#7d8296;font-size:13px;padding:14px 16px;line-height:1.95}
    .side b{color:#cfd3e0;font-weight:500}
    .code{position:absolute;top:52px;left:210px;right:20px;font:13.5px/1.62 "SF Mono",Menlo,monospace;color:#cfd3e0;white-space:pre}
    .code i{display:inline-block;width:34px;color:#4d5266;font-style:normal;text-align:right;margin-right:18px}
    .k{color:#c792ea}.s{color:#c3e88d}.n{color:#f78c6c}.c{color:#676e95}
    .window{position:absolute;left:1120px;top:150px;width:405px;height:540px;box-shadow:0 50px 100px rgba(0,0,0,.6),0 12px 30px rgba(0,0,0,.45)}
  </style>
  <div class="menubar"><b>Code</b><span>File</span><span>Edit</span><span>View</span></div>
  <div class="editor">
    <div class="titlebar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="tab">world-store.ts</span></div>
    <div class="side"><b>src</b><br>&nbsp;&nbsp;engine<br>&nbsp;&nbsp;&nbsp;&nbsp;<b>world-store.ts</b><br>&nbsp;&nbsp;&nbsp;&nbsp;world.ts<br>&nbsp;&nbsp;frame<br>&nbsp;&nbsp;scenes<br>&nbsp;&nbsp;&nbsp;&nbsp;open-sea<br>&nbsp;&nbsp;&nbsp;&nbsp;mountains<br>&nbsp;&nbsp;&nbsp;&nbsp;coast<br><b>src-tauri</b><br>docs</div>
    <div class="code">${code}</div>
  </div>
  <img class="window" src="${await image(windowShot)}">`;
  await compose(browser, html, 1600, 900, join(MEDIA, "desktop.jpg"));
}

async function stripImage(browser, shots, labels, path) {
  const cells = await Promise.all(
    shots.map(
      async (shot, index) =>
        `<figure><img src="${await image(shot)}"><figcaption>${labels[index]}</figcaption></figure>`,
    ),
  );
  const width = shots.length * 220 + (shots.length + 1) * 18;
  const html = `<style>body{margin:0;${BACKDROP}display:flex;gap:18px;padding:22px 18px 14px;font:500 15px -apple-system,system-ui,sans-serif;color:#c9ccd4}figure{margin:0}img{width:220px;height:293px;display:block;box-shadow:0 14px 30px rgba(0,0,0,.5)}figcaption{text-align:center;padding-top:10px}</style>${cells.join("")}`;
  await compose(browser, html, width, 293 + 70, path);
}

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function recordGif(page, { file, scene, snapshot, frames, cursor }) {
  await mkdir(FRAMES, { recursive: true });
  await apply(page, scene, snapshot);
  const box = await page.locator(".window").boundingBox();
  const viewport = page.viewportSize();
  const started = Date.now();
  for (let i = 0; i < frames; i++) {
    if (cursor === "sweep") {
      // Recorrido de ida y vuelta, suavizado, de un lado a otro de la pantalla.
      const t = 0.5 - 0.5 * Math.cos((i / frames) * Math.PI * 2);
      await page.mouse.move(8 + t * (viewport.width - 16), viewport.height * (0.45 + 0.1 * Math.sin((i / frames) * Math.PI * 2)));
    }
    await page.waitForTimeout(60);
    await page.screenshot({ path: join(FRAMES, `frame-${String(i).padStart(3, "0")}.png`), clip: box });
  }
  // La velocidad de reproduccion sale del tiempo real capturado: el movimiento no se acelera.
  const fps = Math.max(4, Math.round(frames / ((Date.now() - started) / 1000)));
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      String(fps),
      "-i",
      join(FRAMES, "frame-%03d.png"),
      "-vf",
      `scale=${GIF_WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      join(MEDIA, file),
    ],
    { stdio: "inherit" },
  );
  await rm(FRAMES, { recursive: true, force: true });
}

async function main() {
  await mkdir(join(MEDIA, "scenes"), { recursive: true });
  await mkdir(FRAMES, { recursive: true });
  const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 1432, strictPort: false } });
  await server.listen();
  const url = `${server.resolvedUrls.local[0]}?capture=1`;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist", "--enable-gpu"] });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 460 }, deviceScaleFactor: 2 });
    await page.goto(url);
    await page.waitForFunction(() => window.__windowDev?.ready === true);

    for (const shot of GALLERY) await shoot(page, shot, join(MEDIA, "scenes", `${shot.scene}.jpg`));

    const desktopShot = join(FRAMES, "desktop-window.jpg");
    await shoot(page, { scene: "open-sea", preset: "golden" }, desktopShot);
    await desktopImage(browser, desktopShot);

    const weatherShots = [];
    for (const [index, shot] of WEATHER.entries()) {
      const path = join(FRAMES, `weather-${index}.jpg`);
      await shoot(page, shot, path);
      weatherShots.push(path);
    }
    await stripImage(browser, weatherShots, ["Noon", "Golden hour", "Full moon", "Rain", "Snow", "Fog"], join(MEDIA, "weather.jpg"));

    const frameShots = [];
    for (const [index, frame] of FRAME_STYLES.entries()) {
      const path = join(FRAMES, `frame-style-${index}.jpg`);
      await shoot(page, { scene: "mountains", preset: "noon", frame }, path);
      frameShots.push(path);
    }
    await stripImage(browser, frameShots, FRAME_STYLES.map((frame) => frame.label), join(MEDIA, "frames.jpg"));
    await rm(FRAMES, { recursive: true, force: true });

    if (!hasFfmpeg()) {
      console.log("ffmpeg not found: skipping animations");
      return;
    }
    const gifPage = await browser.newPage({ viewport: { width: 360, height: 460 }, deviceScaleFactor: 1 });
    await gifPage.goto(url);
    await gifPage.waitForFunction(() => window.__windowDev?.ready === true);
    for (const animation of ANIMATIONS) await recordGif(gifPage, animation);
  } finally {
    await rm(FRAMES, { recursive: true, force: true });
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
