/**
 * PWA branding integrity
 *
 * The app's icon and its iOS launch images are served with the department's
 * own logo rendered onto them, and fall back to the file of the same name in
 * public/ when no logo is configured. Four files have to agree for that to
 * work — index.html, vite.config.ts, frontend/nginx.conf and public/ — and
 * none of them fails loudly when they do not:
 *
 * - a manifest icon whose file is missing is silently dropped by the browser,
 *   which then installs the app under a generic letter tile;
 * - a URL missing from the nginx map is answered by the shipped file forever,
 *   so the department's crest simply never appears and nothing is logged;
 * - a `?v=` that drifts between index.html and vite.config.ts leaves half the
 *   assets pinned to the year-long immutable cache entries browsers already
 *   hold, which is indistinguishable from the feature not working on exactly
 *   the devices that visited before the upgrade.
 *
 * Each of those is discovered by installing the app on a real phone and
 * noticing the wrong picture. This reads the four files instead.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (relative: string): string => fs.readFileSync(path.join(FRONTEND, relative), 'utf8');

const indexHtml = read('index.html');
const viteConfig = read('vite.config.ts');
const nginxConf = read('nginx.conf');
const generator = read('scripts/generate-pwa-assets.mjs');

const revisionIn = (source: string): string | undefined => /PWA_ASSET_REVISION = '([^']+)'/.exec(source)?.[1];

/**
 * Every `href`/`src` in index.html and the manifest that the backend brands.
 *
 * The manifest builds its srcs from a template literal, so the constant is
 * substituted here — the point of the check is the URL a browser receives, not
 * the expression that produced it.
 */
const brandedUrls = (): string[] => {
  const revision = revisionIn(viteConfig) ?? '';
  return [
    ...[...indexHtml.matchAll(/href="(\/apple-(?:touch-icon|splash-\d+-\d+)\.png[^"]*)"/g)].map(
      (match) => match[1] ?? ''
    ),
    ...[...viteConfig.matchAll(/src: [`'](pwa-[\w-]+\.png[^`']*)[`']/g)].map((match) =>
      (match[1] ?? '').replace('${PWA_ASSET_REVISION}', revision)
    ),
  ];
};

describe('PWA asset revision', () => {
  it('is the same in vite.config.ts and the asset generator', () => {
    // The generator prints the <link> tags that get pasted into index.html, so
    // a stale revision there quietly reverts the cache break on the next run.
    expect(revisionIn(generator)).toBe(revisionIn(viteConfig));
  });

  it('is carried by every branded URL', () => {
    const revision = revisionIn(viteConfig);
    expect(revision).toBeTypeOf('string');

    const urls = brandedUrls();
    expect(urls.length).toBeGreaterThan(15);
    for (const url of urls) {
      expect(url, `${url} is missing ?v=${revision ?? ''}`).toContain(`?v=${revision ?? ''}`);
    }
  });
});

describe('branded asset fallbacks', () => {
  it('ships a file for every URL the backend brands', () => {
    // This is what a department with no logo, a deployment with no nginx, and
    // a backend that is still starting all fall back to.
    for (const url of brandedUrls()) {
      const file = (url.split('?')[0] ?? '').replace(/^\//, '');
      expect(fs.existsSync(path.join(FRONTEND, 'public', file)), `public/${file} is missing`).toBe(true);
    }
  });

  it('declares the maskable icon separately from the plain one', () => {
    // One file cannot be both: Android crops a maskable icon, so the two need
    // different renderings and therefore different URLs.
    expect(viteConfig).toContain("purpose: 'maskable'");
    expect(viteConfig).not.toContain("purpose: 'any maskable'");
  });
});

describe('nginx routing', () => {
  it('maps every branded URL to a backend asset', () => {
    for (const url of brandedUrls()) {
      const urlPath = url.split('?')[0] ?? '';
      const splash = /^\/apple-splash-\d+-\d+\.png$/.test(urlPath);
      // Launch images are matched by one regex entry rather than named
      // individually, so they are checked as a group.
      const expected = splash
        ? '~^/apple-splash-(\\d+)-(\\d+)\\.png$'
        : urlPath.startsWith('/')
          ? urlPath
          : `/${urlPath}`;

      expect(nginxConf, `${urlPath} is not in the branded_app_asset map`).toContain(expected);
    }
  });

  it('keeps the branded locations out of the immutable static rule', () => {
    // Those URLs change the day a chief uploads a new crest, so a year of
    // `immutable` on them would outlast several logos.
    const brandedLocation = nginxConf.indexOf('location ~ ^/(pwa-|apple-touch-icon|apple-splash-)');
    const staticLocation = nginxConf.indexOf('location ~* \\.(js|css|png|');

    expect(brandedLocation).toBeGreaterThan(-1);
    expect(staticLocation).toBeGreaterThan(-1);
    // nginx takes the first matching regex location, so order is the check.
    expect(brandedLocation).toBeLessThan(staticLocation);
  });
});
