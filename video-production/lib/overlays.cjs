// Renders a short's static layers (background, screen mask, captions, callout,
// end card) as PNGs for both 9:16 and 16:9, from HTML.
//
// Usage: node overlays.cjs <short-dir> <build-dir>
// Writes <build-dir>/overlays/{v,h}/*.png and overlays/layout.json, which
// compose.py reads for where each layer goes.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [shortDir, buildDir] = process.argv.slice(2);
if (!shortDir || !buildDir) {
  console.error('Usage: node overlays.cjs <short-dir> <build-dir>');
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(path.join(shortDir, 'shots.json'), 'utf8'));
const logoFile = path.join(__dirname, '..', '..', 'frontend', 'public', 'logo-256.png');
const logo = 'data:image/png;base64,' + fs.readFileSync(logoFile).toString('base64');

// The app's primary fill (red-800): white on it clears AAA.
const RED = '#991b1b';
// shots.json is ours, but it is still text going into HTML.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The screen keeps the recording's 390:640 aspect (900x1476 at 9:16).
// Where the recording sits in each frame. The phone boxes (the default 390x640
// screen) are fixed; a short that records another screen size names it under
// "screen" in shots.json and gets a box of that shape fitted to the same space.
const PHONE = { width: 390, height: 640 };
const REGIONS = {
  v: { x: 90, y: 214, w: 900, h: 1476, r: 40 },
  h: { x: 1100, y: 60, w: 780, h: 960, r: 30 },
};
// Down to an even number: ffmpeg's yuv420p needs even sizes, and rounding up
// could overflow the region by a pixel.
const even = (n) => 2 * Math.floor(n / 2);
function screenBox(fmt, screen) {
  if (screen.width === PHONE.width && screen.height === PHONE.height) {
    return fmt === 'v' ? { x: 90, y: 214, w: 900, h: 1476, r: 40 } : { x: 1214, y: 60, w: 586, h: 960, r: 30 };
  }
  const R = REGIONS[fmt];
  const ratio = screen.width / screen.height;
  const w = even(Math.min(R.w, R.h * ratio));
  const h = even(w / ratio);
  return { x: R.x + Math.round((R.w - w) / 2), y: R.y + Math.round((R.h - h) / 2), w, h, r: R.r };
}
const SCREEN_SIZE = spec.screen ?? PHONE;
// A guide is a long 16:9 video: the recording fills the frame under a header
// bar, sections are announced by a banner over the screen's lower left, and
// the narration is carried by an .srt rather than a caption per shot.
const GUIDE = spec.kind === 'guide';
function guideLayout() {
  const R = { x: 60, y: 110, w: 1800, h: 940 };
  const ratio = SCREEN_SIZE.width / SCREEN_SIZE.height;
  const w = even(Math.min(R.w, R.h * ratio));
  const h = even(w / ratio);
  const screen = { x: R.x + Math.round((R.w - w) / 2), y: R.y + Math.round((R.h - h) / 2), w, h, r: 24 };
  const banner = { x: screen.x + 40, y: screen.y + screen.h - 190, w: 1040, h: 150 };
  return { W: 1920, H: 1080, screen, caption: banner, banner };
}
const LAYOUTS = GUIDE
  ? { h: guideLayout() }
  : {
      v: { W: 1080, H: 1920, screen: screenBox('v', SCREEN_SIZE), caption: { x: 60, y: 1700, w: 960, h: 200 } },
      h: { W: 1920, H: 1080, screen: screenBox('h', SCREEN_SIZE), caption: { x: 120, y: 420, w: 960, h: 400 } },
    };

const page = (W, H, body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden}
  *{box-sizing:border-box;font-family:Inter,'DejaVu Sans',sans-serif}
  ${css}</style></head><body>${body}</body></html>`;

const BG_CSS = `.bg{position:absolute;inset:0;background:radial-gradient(120% 80% at 20% 0%,#7f1d1d 0%,#1f2937 55%,#0b1120 100%)}`;

const brand = (size) => `<div style="display:flex;align-items:center;gap:${size * 0.35}px">
    <img src="${logo}" style="width:${size}px;height:${size}px;border-radius:${size * 0.22}px;background:#fff;padding:${size * 0.06}px">
    <div style="color:#fff;font-weight:800;font-size:${size * 0.5}px;letter-spacing:-.01em">The Logbook</div>
  </div>`;

const screenShadow = (S) =>
  `<div style="position:absolute;left:${S.x - 6}px;top:${S.y - 6}px;width:${S.w + 12}px;height:${S.h + 12}px;border-radius:${S.r + 6}px;background:#000;box-shadow:0 30px 80px rgba(0,0,0,.55)"></div>`;

function guideLayers() {
  const { W, H, screen: S, banner: B } = LAYOUTS.h;
  const out = {};
  const label = [spec.series, spec.chapter].filter(Boolean).map(esc).join(' · ');
  out.bg = page(W, H, `<div class="bg"></div>
      <div style="position:absolute;left:60px;right:60px;top:18px;height:72px;display:flex;align-items:center;justify-content:space-between">
        ${brand(64)}<div style="color:#fff;font-weight:700;font-size:30px;opacity:.92">${label}</div></div>
      ${screenShadow(S)}`, BG_CSS);
  out.mask = page(S.w, S.h, `<div style="position:absolute;inset:0;border-radius:${S.r}px;background:#fff"></div>`, 'html,body{background:#000}');
  out.title = page(W, H, `<div class="bg"></div>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;color:#fff;text-align:center">
        ${brand(110)}
        <div style="display:inline-block;background:${RED};font-weight:800;font-size:30px;letter-spacing:.08em;text-transform:uppercase;padding:10px 22px;border-radius:999px">${label}</div>
        <div style="font-weight:800;font-size:96px;letter-spacing:-.02em">${esc(spec.title)}</div>
      </div>`, BG_CSS);
  const banner = (kicker, text, accent) =>
    page(B.w, B.h, `<div style="position:absolute;left:0;bottom:0;max-width:${B.w}px;display:flex;align-items:stretch;border-radius:22px;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,.45)">
        <div style="width:14px;background:${RED}"></div>
        <div style="background:${accent ? RED : 'rgba(17,24,39,.94)'};color:#fff;padding:18px 30px">
          <div style="font-weight:700;font-size:24px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(kicker)}</div>
          <div style="font-weight:800;font-size:46px;line-height:1.15">${esc(text)}</div>
        </div></div>`);
  spec.shots.forEach((s) => {
    if (s.section) out[`sec-${s.id}`] = banner(spec.chapter ?? spec.series ?? '', s.section, false);
  });
  out.callout = banner('Remember', spec.callout, true);
  out.end = endCard('h');
  return out;
}

function endCard(fmt) {
  const { W, H } = LAYOUTS[fmt];
  const vertical = fmt === 'v';
  const e = spec.endCard;
  return page(W, H, `<div class="bg"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff;gap:${vertical ? 40 : 30}px">
      <img src="${logo}" style="width:${vertical ? 260 : 200}px;height:${vertical ? 260 : 200}px;border-radius:48px;background:#fff;padding:16px">
      <div style="font-weight:800;font-size:${vertical ? 96 : 92}px;letter-spacing:-.02em">${esc(e.headline)}</div>
      <div style="font-weight:600;font-size:${vertical ? 54 : 52}px;opacity:.92">${esc(e.sub)}</div>
      <div style="font-weight:700;font-size:40px;background:rgba(255,255,255,.12);padding:16px 30px;border-radius:999px">${esc(e.url)}</div>
    </div>`, BG_CSS);
}

function layers(fmt) {
  if (GUIDE) return guideLayers();
  const { W, H, screen: S, caption: C } = LAYOUTS[fmt];
  const vertical = fmt === 'v';
  const out = {};

  const tip = `<div style="display:inline-block;background:${RED};color:#fff;font-weight:800;font-size:${vertical ? 26 : 24}px;letter-spacing:.08em;text-transform:uppercase;padding:8px 16px;border-radius:999px">Quick Tip</div>`;
  out.bg = vertical
    ? page(W, H, `<div class="bg"></div>
        <div style="position:absolute;left:90px;right:90px;top:52px;display:flex;align-items:center;justify-content:space-between">${brand(96)}${tip}</div>
        ${screenShadow(S)}`, BG_CSS)
    : page(W, H, `<div class="bg"></div>
        <div style="position:absolute;left:120px;top:90px">${brand(96)}</div>
        <div style="position:absolute;left:120px;top:250px">${tip}
          <div style="color:#fff;font-weight:800;font-size:76px;line-height:1.05;margin-top:22px;letter-spacing:-.02em">${esc(spec.title)}</div></div>
        ${screenShadow(S)}`, BG_CSS);

  // White keeps, black cuts: rounds the recording's corners.
  out.mask = page(S.w, S.h, `<div style="position:absolute;inset:0;border-radius:${S.r}px;background:#fff"></div>`, 'html,body{background:#000}');

  const box = vertical
    ? 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center'
    : 'position:absolute;inset:0;display:flex;align-items:center';
  const caption = (text, accent) =>
    page(C.w, C.h, `<div style="${box}"><div style="display:inline-block;background:${accent ? RED : 'rgba(255,255,255,.97)'};color:${accent ? '#fff' : '#111827'};font-weight:800;font-size:${vertical ? 56 : 64}px;line-height:1.15;padding:${vertical ? '20px 34px' : '26px 40px'};border-radius:28px;box-shadow:0 12px 40px rgba(0,0,0,.4);max-width:${C.w}px">${esc(text)}</div></div>`);
  for (const s of spec.shots) out[`cap-${s.id}`] = caption(s.caption, false);
  out.callout = caption(spec.callout, true);

  out.end = endCard(fmt);
  return out;
}

(async () => {
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}
  );
  try {
    for (const fmt of Object.keys(LAYOUTS)) {
      const dir = path.join(buildDir, 'overlays', fmt);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, html] of Object.entries(layers(fmt))) {
        const tab = await browser.newPage();
        await tab.setContent(html);
        const { w, h } = await tab.evaluate(() => ({ w: document.body.offsetWidth, h: document.body.offsetHeight }));
        await tab.setViewportSize({ width: w, height: h });
        await tab.evaluate(() => document.fonts.ready);
        await tab.screenshot({ path: path.join(dir, `${name}.png`), omitBackground: true });
        await tab.close();
      }
    }
    fs.writeFileSync(path.join(buildDir, 'overlays', 'layout.json'), JSON.stringify(LAYOUTS, null, 2));
  } finally {
    await browser.close();
  }
})();
