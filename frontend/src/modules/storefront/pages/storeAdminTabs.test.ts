import { describe, it, expect } from 'vitest';
import { STORE_ADMIN_AREAS, STORE_ADMIN_TABS, resolveStoreAdminLocation } from './storeAdminTabs';

describe('Store admin areas', () => {
  it('files every tab under exactly one area', () => {
    const filed = STORE_ADMIN_AREAS.flatMap((area) => area.destinations.map((destination) => destination.id));
    expect([...filed].sort()).toEqual(STORE_ADMIN_TABS.map((tab) => tab.id).sort());
    expect(new Set(filed).size).toBe(filed.length);
  });

  it('keeps settings last', () => {
    expect(STORE_ADMIN_AREAS[STORE_ADMIN_AREAS.length - 1]?.id).toBe('setup');
  });

  it('gives no area the name of a page', () => {
    const pageLabels = new Set(STORE_ADMIN_TABS.map((tab) => tab.label));
    for (const area of STORE_ADMIN_AREAS) expect(pageLabels.has(area.label)).toBe(false);
  });

  it.each([
    ['overview', 'glance'],
    ['windows', 'selling'],
    ['catalog', 'selling'],
    ['orders', 'fulfilment'],
    ['payments', 'fulfilment'],
    ['settings', 'setup'],
  ])('resolves ?tab=%s to the %s area', (tab, area) => {
    const location = resolveStoreAdminLocation(tab);
    expect(location.tab).toBe(tab);
    expect(location.area.id).toBe(area);
  });

  it.each([null, '', 'unknown', 'toString'])('opens Overview for a tab of %p', (tab) => {
    const location = resolveStoreAdminLocation(tab);
    expect(location.tab).toBe('overview');
    expect(location.area.id).toBe('glance');
  });
});
