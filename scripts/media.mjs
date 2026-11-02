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

const HERO = [
  { scene: "mountains", preset: "noon" },
  { scene: "alpine-lake", preset: "golden" },
  { scene: "open-sea", preset: "golden" },
  { scene: "rooftops", preset: "night" },
  { scene: "coast", preset: "moon" },
];

const WEATHER = ["noon", "golden", "moon", "rain", "snow", "fog"].map((preset) => ({ scene: "coast", preset }));

const FRAME_STYLES = [
  { frameStyle: "classic", frameColor: "ivory", label: "Classic, ivory" },
  { frameStyle: "modern", frameColor: "black", label: "Modern, black" },
  { frameStyle: "industrial", frameColor: "oak", label: "Industrial, oak" },
  { frameStyle: "classic", frameColor: "sage", label: "Classic, sage" },
];

async function shoot(page, { scene, preset, frame = DEFAULT_FRAME }, path) {
  await page.evaluate(
    async ({ scene, snapshot, frame }) => {
      await window.__windowDev.previewSettings(frame);
      await window.__windowDev.selectScene(scene);
      window.__windowDev.simulate(snapshot);
    },
    { scene, snapshot: PRESETS[preset], frame },
  );
  await page.waitForTimeout(SETTLE_MS);
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

async function heroImage(browser, shots) {
  const sizes = [0.82, 0.92, 1, 0.92, 0.82];
  const windows = await Promise.all(
    shots.map(async (path, index) => {
      const scale = sizes[index];
      return `<img src="${await image(path)}" style="width:${Math.round(300 * scale)}px;height:${Math.round(400 * scale)}px;z-index:${10 - Math.abs(index - 2)};box-shadow:0 30px 60px rgba(0,0,0,.55),0 8px 20px rgba(0,0,0,.4)">`;
    }),
  );
  const html = `<style>body{margin:0;width:1600px;height:620px;${BACKDROP}display:flex;align-items:center;justify-content:center;gap:26px}img{display:block;border-radius:2px}</style>${windows.join("")}`;
  await compose(browser, html, 1600, 620, join(MEDIA, "hero.jpg"));
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

async function parallaxGif(page, path) {
  const ffmpeg = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  if (!ffmpeg) {
    console.log("ffmpeg not found: skipping parallax.gif");
    return;
  }
  await mkdir(FRAMES, { recursive: true });
  await page.evaluate(
    async ({ snapshot }) => {
      await window.__windowDev.previewSettings({ frameStyle: "classic", frameColor: "ivory" });
      await window.__windowDev.selectScene("mountains");
      window.__windowDev.simulate(snapshot);
    },
    { snapshot: PRESETS.noon },
  );
  await page.waitForTimeout(SETTLE_MS);
  const box = await page.locator(".window").boundingBox();
  const viewport = page.viewportSize();
  const frames = 36;
  for (let i = 0; i < frames; i++) {
    // Recorrido de ida y vuelta, suavizado, de un lado a otro de la pantalla.
    const t = 0.5 - 0.5 * Math.cos((i / frames) * Math.PI * 2);
    await page.mouse.move(8 + t * (viewport.width - 16), viewport.height * (0.45 + 0.1 * Math.sin((i / frames) * Math.PI * 2)));
    await page.waitForTimeout(90);
    await page.screenshot({
      path: join(FRAMES, `frame-${String(i).padStart(3, "0")}.png`),
      clip: box,
    });
  }
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-framerate",
      "12",
      "-i",
      join(FRAMES, "frame-%03d.png"),
      "-vf",
      "scale=280:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
      path,
    ],
    { stdio: "inherit" },
  );
  await rm(FRAMES, { recursive: true, force: true });
}

async function main() {
  await mkdir(join(MEDIA, "scenes"), { recursive: true });
  const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 1432, strictPort: false } });
  await server.listen();
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist", "--enable-gpu"] });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 460 }, deviceScaleFactor: 2 });
    await page.goto(`${server.resolvedUrls.local[0]}?capture=1`);
    await page.waitForFunction(() => window.__windowDev?.ready === true);

    for (const shot of GALLERY) await shoot(page, shot, join(MEDIA, "scenes", `${shot.scene}.jpg`));

    const heroShots = [];
    for (const [index, shot] of HERO.entries()) {
      const path = join(FRAMES, `hero-${index}.jpg`);
      await mkdir(FRAMES, { recursive: true });
      await shoot(page, shot, path);
      heroShots.push(path);
    }
    await heroImage(browser, heroShots);

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
    const gifPage = await browser.newPage({ viewport: { width: 360, height: 460 }, deviceScaleFactor: 1 });
    await gifPage.goto(`${server.resolvedUrls.local[0]}?capture=1`);
    await gifPage.waitForFunction(() => window.__windowDev?.ready === true);
    await parallaxGif(gifPage, join(MEDIA, "parallax.gif"));
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
