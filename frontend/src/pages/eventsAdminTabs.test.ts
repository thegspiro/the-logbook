import { describe, it, expect } from 'vitest';
import { EVENTS_ADMIN_AREAS, EVENTS_ADMIN_TABS, resolveEventsAdminLocation } from './eventsAdminTabs';

describe('Events admin areas', () => {
  it('files every tab under exactly one area', () => {
    const filed = EVENTS_ADMIN_AREAS.flatMap((area) => area.destinations.map((destination) => destination.id));
    expect([...filed].sort()).toEqual(EVENTS_ADMIN_TABS.map((tab) => tab.id).sort());
    expect(new Set(filed).size).toBe(filed.length);
  });

  it('keeps Settings last', () => {
    expect(EVENTS_ADMIN_AREAS[EVENTS_ADMIN_AREAS.length - 1]?.id).toBe('settings');
  });

  it.each([
    ['create', 'events'],
    ['past_events', 'events'],
    ['requests', 'outreach'],
    ['community', 'outreach'],
    ['analytics', 'check_ins'],
    ['card_checkins', 'check_ins'],
    ['settings', 'settings'],
  ])('resolves ?tab=%s to the %s area', (tab, area) => {
    const location = resolveEventsAdminLocation(tab);
    expect(location.tab).toBe(tab);
    expect(location.area.id).toBe(area);
  });

  it.each([null, '', 'unknown'])('opens Create Event for a tab of %p', (tab) => {
    const location = resolveEventsAdminLocation(tab);
    expect(location.tab).toBe('create');
    expect(location.area.id).toBe('events');
  });
});
