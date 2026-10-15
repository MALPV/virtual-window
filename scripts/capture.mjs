// Captura cada escena con varios climas y horas para revisarlas visualmente sin abrir la app.
// Uso: npm run capture [-- escena1 escena2 ...] [-- --presets=noon,night]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT = join(ROOT, ".captures");
const WINDOW_SIZE = { width: 300, height: 400 };
const SETTLE_MS = 2200;

const weather = (overrides) => ({
  condition: "clear",
  intensity: 0,
  cloudCover: 0.2,
  temperature: 18,
  windDrift: 0.2,
  windStrength: 0.25,
  ...overrides,
});

const PRESETS = {
  noon: { sunElevation: 58, sunTrack: 0.55, locationKnown: true, weather: weather({ cloudCover: 0.25 }) },
  golden: { sunElevation: 4, sunTrack: 0.82, locationKnown: true, weather: weather({ condition: "cloudy", cloudCover: 0.4 }) },
  night: { sunElevation: -26, sunTrack: 0.5, locationKnown: true, weather: weather({ cloudCover: 0.05 }) },
  rain: {
    sunElevation: 25,
    sunTrack: 0.4,
    locationKnown: true,
    weather: weather({ condition: "rain", intensity: 0.8, cloudCover: 1, windDrift: 0.5, windStrength: 0.5, temperature: 11 }),
  },
  snow: {
    sunElevation: 15,
    sunTrack: 0.35,
    locationKnown: true,
    weather: weather({ condition: "snow", intensity: 0.6, cloudCover: 1, temperature: -4 }),
  },
  fog: {
    sunElevation: 8,
    sunTrack: 0.6,
    locationKnown: true,
    weather: weather({ condition: "fog", intensity: 0.85, cloudCover: 0.9, temperature: 6 }),
  },
};

function parseArgs(argv) {
  const scenes = [];
  let presets = Object.keys(PRESETS);
  for (const arg of argv) {
    if (arg.startsWith("--presets=")) presets = arg.slice("--presets=".length).split(",").filter((p) => p in PRESETS);
    else if (!arg.startsWith("--")) scenes.push(arg);
  }
  return { scenes, presets };
}

async function contactSheet(page, scene, presets) {
  const cells = await Promise.all(
    presets.map(async (preset) => {
      const data = await readFile(join(OUTPUT, `${scene}-${preset}.png`));
      return `<figure><img src="data:image/png;base64,${data.toString("base64")}"><figcaption>${preset}</figcaption></figure>`;
    }),
  );
  const html = `<!doctype html><style>
    body{margin:0;background:#1e2024;font:12px system-ui;color:#ccc;display:grid;grid-template-columns:repeat(3,300px);gap:12px;padding:12px}
    figure{margin:0} img{width:300px;height:400px;display:block} figcaption{padding:4px 0}
  </style>${cells.join("")}`;
  await page.setContent(html);
  await page.setViewportSize({ width: 3 * 300 + 4 * 12, height: Math.ceil(presets.length / 3) * 432 + 12 });
  await page.screenshot({ path: join(OUTPUT, `${scene}-sheet.png`), fullPage: true });
}

async function main() {
  const { scenes: requested, presets } = parseArgs(process.argv.slice(2));
  await mkdir(OUTPUT, { recursive: true });

  const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 1431, strictPort: false } });
  await server.listen();
  const url = `${server.resolvedUrls.local[0]}?capture=1`;
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist", "--enable-gpu"] });
  const errors = [];

  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 460 }, deviceScaleFactor: 2 });
    page.on("console", (message) => {
      const text = message.text();
      // El 404 del favicon no es un error de la app.
      if (text.startsWith("Failed to load resource")) return;
      if (message.type() === "error" || message.type() === "warning") errors.push(text);
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("response", (response) => {
      const path = new URL(response.url()).pathname;
      if (response.status() >= 400 && path !== "/favicon.ico") errors.push(`HTTP ${response.status()} ${path}`);
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__windowDev?.ready === true);

    const available = await page.evaluate(() => window.__windowDev.scenes);
    const scenes = requested.length > 0 ? requested.filter((id) => available.includes(id)) : available;

    for (const scene of scenes) {
      await page.evaluate((id) => window.__windowDev.selectScene(id), scene);
      for (const preset of presets) {
        await page.evaluate((snapshot) => window.__windowDev.simulate(snapshot), PRESETS[preset]);
        await page.waitForTimeout(SETTLE_MS);
        const active = await page.evaluate(() => window.__windowDev.activeScene());
        if (active !== scene) errors.push(`${scene}: expected active scene, got ${active} (failed to mount?)`);
        await page.locator(".window").screenshot({ path: join(OUTPUT, `${scene}-${preset}.png`) });
      }
      const sheetPage = await browser.newPage({ deviceScaleFactor: 1 });
      await contactSheet(sheetPage, scene, presets);
      await sheetPage.close();
      console.log(`captured ${scene}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }

  await writeFile(join(OUTPUT, "errors.txt"), errors.join("\n"));
  if (errors.length > 0) console.log(`${errors.length} console errors/warnings, see .captures/errors.txt`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
