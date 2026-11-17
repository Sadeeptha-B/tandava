// Headless screenshot helper for visual verification.
//   node tools/shot.mjs <out.png> "<query string | page.html?query>" [width] [height] ["js expression to await before capture"]
// Requires the dev server (npm run dev) on http://localhost:5173 and a local Edge/Chrome.
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const [out = 'shot.png', query = '', w = '960', h = '1080', expr = ''] = process.argv.slice(2);
const candidates = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chromium-based browser found; set BROWSER_PATH');

const browser = await puppeteer.launch({
  executablePath, headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--mute-audio'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
  if (process.env.REDUCED_MOTION) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  // PRE_EVAL: script evaluated before the page's own code (dev flags such as window.__sashDebug = true)
  if (process.env.PRE_EVAL) await page.evaluateOnNewDocument(process.env.PRE_EVAL);
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[t]')) console.log(`[${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // query may be "a=1&b=2" (main page) or "lab.html?a=1" (another page)
  const url = `${process.env.APP_URL ?? 'http://localhost:5173'}/${query.includes('?') || query.endsWith('.html') ? query : '?' + query}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 120000 });
  if (expr) {
    const r = await page.evaluate(`(async () => { return await (${expr}); })()`);
    if (r !== undefined && r !== null) console.log(typeof r === 'string' ? r : JSON.stringify(r));
  }
  await page.screenshot({ path: out, type: out.endsWith('.jpg') ? 'jpeg' : 'png', ...(out.endsWith('.jpg') ? { quality: 88 } : {}) });
  console.log('saved', out);
} finally {
  await browser.close();
}
