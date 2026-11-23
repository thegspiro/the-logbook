/**
 * The CRR map on Outreach Impact, in a real browser.
 *
 * The unit tests replace Leaflet with a recorder, so they cannot see whether
 * the library and its stylesheet actually draw: a Tailwind reset that squashes
 * tile images, or a stylesheet that never loads with the lazy chunk, renders
 * an empty grey box and passes every jsdom test. This opens the map and checks
 * what the page shows.
 *
 * It also holds the privacy rule (owner decision, 2026-11-23): nothing is
 * requested from OpenStreetMap until someone asks for the map. Tile requests
 * are answered here with a blank image, so the test never reaches the network.
 */

import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// A 1x1 transparent PNG.
const BLANK_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

test.describe('CRR map on Outreach Impact', () => {
  test('asks OpenStreetMap for nothing until the map is opened, then draws a circle per ZIP', async ({ page }) => {
    const tileRequests: string[] = [];
    await page.route('https://tile.openstreetmap.org/**', (route) => {
      tileRequests.push(route.request().url());
      void route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE });
    });
    await signIn(page, { permissions: ['events.manage'] });
    await page.goto('/events/admin?tab=community');

    const section = page.getByRole('region', { name: 'Community risk reduction' });
    await expect(section.getByText('14 activities this year')).toBeVisible();
    expect(tileRequests).toEqual([]);

    await section.getByRole('button', { name: 'Show map' }).click();

    const map = section.getByRole('region', { name: 'Map of CRR activities by ZIP code' });
    await expect(map).toBeVisible();
    // One circle for each ZIP code the fixture places (22046 and 22044).
    await expect(map.locator('path.leaflet-interactive')).toHaveCount(2);
    await expect(map.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
    await expect.poll(() => tileRequests.length).toBeGreaterThan(0);
    // The stylesheet came with the lazy chunk: without it the tile pane is
    // not positioned and the map has no height to draw into.
    const height = await map.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(200);
    await expect(map.locator('.leaflet-tile-pane')).toHaveCSS('position', 'absolute');
  });
});
