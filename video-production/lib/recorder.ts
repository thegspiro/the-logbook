import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Locator, Page } from '@playwright/test';

/**
 * Shared capture machinery for every short.
 *
 * A short's capture spec drives the real UI against the E2E suite's mocked API
 * and calls `recordShots`, which records the screen through CDP's screencast
 * and holds each shot for at least as long as its narration. The compositor
 * reads the frames and the shot start times this writes.
 */

/** CSS viewport of the recorded phone screen. */
export const SCREEN = { width: 390, height: 640 };

/**
 * Device pixels per CSS pixel: the phone screen is 900px wide in the 9:16
 * frame. playwright.config.ts passes the same value to Chromium as
 * --force-device-scale-factor, without which the screencast delivers frames at
 * CSS size (390x640) and the result is a soft upscale.
 */
export const SCALE = 900 / 390;

/** Pause after each narrated line before the next shot starts, in seconds. */
const GAP = 0.45;

export const VIDEO_ROOT = join(__dirname, '..');

/** Where one short's generated files go; everything under build/ is gitignored. */
export function buildDir(shortId: string): string {
  return join(VIDEO_ROOT, 'build', shortId);
}

/** A finger-sized marker, since a headless browser draws no pointer. */
const TAP_SCRIPT = `
  window.__videoTap = (x, y) => {
    const d = document.createElement('div');
    d.dataset.videoTap = '1';
    d.style.cssText = 'position:fixed;left:' + (x - 22) + 'px;top:' + (y - 22) + 'px;width:44px;height:44px;' +
      'border-radius:50%;background:rgba(255,255,255,.55);border:3px solid rgba(17,24,39,.75);' +
      'box-shadow:0 2px 10px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;' +
      'transform:scale(.4);opacity:0;transition:transform .18s ease-out,opacity .18s ease-out';
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'scale(1)'; d.style.opacity = '1'; });
  };
  window.__videoRelease = () => {
    document.querySelectorAll('[data-video-tap]').forEach((d) => {
      d.style.transition = 'transform .35s ease-out,opacity .35s ease-out';
      d.style.transform = 'scale(1.8)';
      d.style.opacity = '0';
      setTimeout(() => d.remove(), 400);
    });
  };
`;

interface TapWindow {
  __videoTap: (x: number, y: number) => void;
  __videoRelease: () => void;
}

/** Install the tap marker. Call before the first navigation. */
export async function prepare(page: Page): Promise<void> {
  await page.addInitScript(TAP_SCRIPT);
}

/** Wait for network, fonts and entry animations so nothing is caught mid-fade. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

/** Tap a control the way a viewer should see it: marker, press, release. */
export async function tap(page: Page, target: Locator): Promise<void> {
  await target.waitFor({ state: 'visible', timeout: 8000 });
  // Keep the target clear of the sticky header and the bottom tab bar, which
  // would otherwise take the click; a smooth scroll also reads better on
  // video than a jump.
  let box = await target.boundingBox();
  if (box && (box.y < 80 || box.y + box.height > SCREEN.height - 90)) {
    await target.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await page.waitForTimeout(750);
    box = await target.boundingBox();
  }
  if (!box) throw new Error('tap target has no bounding box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([px, py]) => (window as unknown as TapWindow).__videoTap(px ?? 0, py ?? 0), [x, y]);
  await page.waitForTimeout(380);
  await page.mouse.click(x, y);
  await page.evaluate(() => (window as unknown as TapWindow).__videoRelease());
}

/**
 * The visible match lowest on screen. The layout renders some controls twice
 * (the phone's bottom tab bar and a hidden desktop copy), and the tab bar is
 * the one a viewer sees.
 */
export async function bottomMost(loc: Locator): Promise<Locator> {
  let best: Locator | undefined;
  let bestY = -1;
  for (const l of await loc.all()) {
    if (!(await l.isVisible())) continue;
    const b = await l.boundingBox();
    if (b && b.y > bestY) {
      bestY = b.y;
      best = l;
    }
  }
  if (!best) throw new Error('no visible match');
  return best;
}

/** Smooth-scroll an element to the middle of the screen. */
export async function centre(page: Page, target: Locator): Promise<void> {
  await target.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await page.waitForTimeout(800);
}

export type Shot = (id: string, act: () => Promise<void>) => Promise<void>;

/**
 * Record the screen while `run` performs the shots. The page should already be
 * on its first screen, settled.
 *
 * Each `shot(id, act)` starts a shot, performs it, then holds until the shot's
 * narration (from audio/durations.json) plus a short gap has elapsed. Shot ids
 * must match shots.json.
 */
export async function recordShots(page: Page, shortId: string, run: (shot: Shot) => Promise<void>): Promise<void> {
  const out = buildDir(shortId);
  const framesDir = join(out, 'frames');
  const stillsDir = join(out, 'stills');
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(stillsDir, { recursive: true });
  const durations = JSON.parse(readFileSync(join(out, 'audio', 'durations.json'), 'utf8')) as Record<string, number>;

  // Frames arrive only when the screen changes; each carries its own
  // timestamp, which the compositor turns into frame durations.
  const cdp = await page.context().newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    const file = `frames/${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(out, file), Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 95,
    maxWidth: Math.round(SCREEN.width * SCALE),
    maxHeight: Math.round(SCREEN.height * SCALE),
    everyNthFrame: 1,
  });
  await page.waitForTimeout(300);

  const marks: Record<string, number> = {};
  let index = 0;
  const shot: Shot = async (id, act) => {
    if (!(id in durations)) throw new Error(`shot "${id}" has no narration; check shots.json`);
    const t0 = Date.now();
    marks[id] = t0 / 1000;
    await act();
    index += 1;
    // A still per shot, for reviewing a capture without playing the video.
    await page.screenshot({ path: join(stillsDir, `${index}-${id}.png`), scale: 'css' });
    const hold = (durations[id] ?? 0) + GAP - (Date.now() - t0) / 1000;
    if (hold > 0) await page.waitForTimeout(hold * 1000);
  };

  await run(shot);
  marks.end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(out, 'frames.json'), JSON.stringify({ frames, marks }, null, 2));
}
