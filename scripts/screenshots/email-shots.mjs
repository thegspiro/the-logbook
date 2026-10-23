/**
 * Photograph an email's HTML at phone width.
 *
 * An email is not a screen of the application, so capture.mjs cannot visit it.
 * `render_supply_email.py` writes the message the weekly Supplies to Replace
 * task would send, and this draws that file at the width a phone gives an
 * email, the way a mail client would, and writes the image to the guide's
 * images directory.
 *
 * Usage:
 *   node scripts/screenshots/email-shots.mjs <html-file> <image-name> [outDir]
 *
 * CHROMIUM_PATH points at an existing Chromium where Playwright's pinned
 * revision is not installed, as for the other scripts here.
 */

import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";

const run = promisify(execFile);

const [, , htmlFile, imageName, outArg] = process.argv;
if (!htmlFile || !imageName) {
  console.error(
    "usage: node email-shots.mjs <html-file> <image-name> [outDir]",
  );
  process.exit(2);
}
const OUT = outArg ?? "docs/training/images";
const MOBILE = { width: 390, height: 844 };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
try {
  const context = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve(htmlFile)).toString());
  const target = path.join(OUT, `${imageName}.png`);
  await page.screenshot({ path: target, fullPage: true });
  try {
    await run("pngquant", [
      "--quality=70-92",
      "--speed",
      "1",
      "--force",
      "--output",
      target,
      target,
    ]);
  } catch {
    // pngquant missing is not fatal -- the capture is correct, just larger.
  }
  console.log(`wrote ${target}`);
} finally {
  await browser.close();
}
