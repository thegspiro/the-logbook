/**
 * Generates iOS launch images and the social-preview image from the full-size
 * logo. The 1024x1024 source lives outside public/ so Vite does not copy its
 * ~1.7MB into every build — nothing serves it, and the derived assets
 * (logo-128, logo-256, og-image, splashes) are what the app actually loads.
 *
 * iOS does not derive a launch screen from the web app manifest — an installed
 * PWA shows a blank white screen on every cold start unless a matching
 * `apple-touch-startup-image` is supplied for that exact device geometry. Each
 * entry below therefore has to match a real device's CSS size and DPR; there is
 * no scaling fallback.
 *
 * Run with `npm run generate:pwa-assets` after changing the logo. Requires
 * sharp, which is a devDependency only — the generated PNGs are committed so a
 * normal install/build never needs it.
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public');
const SOURCE = path.resolve(__dirname, '../assets/logo-source.png');

/** Matches manifest background_color, so the splash blends into first paint. */
const BACKGROUND = { r: 15, g: 23, b: 42, alpha: 1 }; // #0f172a

/**
 * CSS width/height and device pixel ratio per device family. Devices that share
 * a geometry share an image, so this covers considerably more models than rows.
 */
const SPLASH_TARGETS = [
  { w: 320, h: 568, dpr: 2 }, // iPhone SE (1st gen), 5s
  { w: 375, h: 667, dpr: 2 }, // iPhone SE (2nd/3rd gen), 8, 7, 6s
  { w: 390, h: 844, dpr: 3 }, // iPhone 14, 13, 13 Pro, 12, 12 Pro
  { w: 393, h: 852, dpr: 3 }, // iPhone 16, 15, 15 Pro, 14 Pro
  { w: 402, h: 874, dpr: 3 }, // iPhone 16 Pro
  { w: 414, h: 736, dpr: 3 }, // iPhone 8 Plus, 7 Plus, 6s Plus
  { w: 414, h: 896, dpr: 2 }, // iPhone 11, XR
  { w: 428, h: 926, dpr: 3 }, // iPhone 14 Plus, 13 Pro Max, 12 Pro Max
  { w: 430, h: 932, dpr: 3 }, // iPhone 16 Plus, 15 Pro Max, 14 Pro Max
  { w: 440, h: 956, dpr: 3 }, // iPhone 16 Pro Max
  { w: 768, h: 1024, dpr: 2 }, // iPad (9.7"), iPad mini
  { w: 810, h: 1080, dpr: 2 }, // iPad 10.2"
  { w: 820, h: 1180, dpr: 2 }, // iPad Air 10.9"
  { w: 1024, h: 1366, dpr: 2 }, // iPad Pro 12.9"
];

async function makeSplash({ w, h, dpr }) {
  const pxW = w * dpr;
  const pxH = h * dpr;
  // Keep the mark comfortably inside the shortest edge so it never collides
  // with a notch, a home indicator, or the rounded display corners.
  const logoSize = Math.round(Math.min(pxW, pxH) * 0.38);
  const logo = await sharp(SOURCE)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const name = `apple-splash-${pxW}-${pxH}.png`;
  await sharp({ create: { width: pxW, height: pxH, channels: 4, background: BACKGROUND } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(PUBLIC, name));
  return { name, w, h, dpr, pxW, pxH };
}

async function makeSocialImage() {
  // 1200x630 is the Open Graph standard; the 1024x1024 source is ~1.7MB, far
  // too heavy for a link unfurl that chat clients fetch eagerly.
  const logo = await sharp(SOURCE)
    .resize(520, 520, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: BACKGROUND } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(PUBLIC, 'og-image.png'));
}

const made = [];
for (const target of SPLASH_TARGETS) {
  made.push(await makeSplash(target));
}
await makeSocialImage();

// Emit the <link> tags so index.html can be kept in sync by hand without
// re-deriving the media queries, which are unforgiving.
console.log('\n--- apple-touch-startup-image links ---');
for (const m of made) {
  console.log(
    `    <link rel="apple-touch-startup-image" media="(device-width: ${m.w}px) and (device-height: ${m.h}px) and (-webkit-device-pixel-ratio: ${m.dpr}) and (orientation: portrait)" href="/${m.name}" />`,
  );
}
console.log(`\ngenerated ${made.length} splash images + og-image.png`);
