import { describe, it, expect } from 'vitest';
import {
  MEMBERS_ADMIN_AREAS,
  MEMBERS_ADMIN_TABS,
  membersAdminAreasFor,
  resolveMembersAdminLocation,
} from './membersAdminTabs';

const allowAll = () => true;
const allowNone = () => false;

describe('Members admin areas', () => {
  it('files every tab under exactly one area', () => {
    const filed = MEMBERS_ADMIN_AREAS.flatMap((area) => area.destinations.map((destination) => destination.id));
    expect([...filed].sort()).toEqual(MEMBERS_ADMIN_TABS.map((tab) => tab.id).sort());
    expect(new Set(filed).size).toBe(filed.length);
  });

  it('keeps Settings last', () => {
    expect(MEMBERS_ADMIN_AREAS[MEMBERS_ADMIN_AREAS.length - 1]?.id).toBe('settings');
  });

  it('leaves out the pages behind users.create for a member without it', () => {
    const areas = membersAdminAreasFor(allowNone);
    const filed = areas.flatMap((area) => area.destinations.map((destination) => destination.id));
    expect(filed).toEqual(['manage', 'qualifications', 'settings']);
  });

  it.each([
    ['manage', 'roster'],
    ['add', 'add_import'],
    ['import', 'add_import'],
    ['qualifications', 'add_import'],
    ['settings', 'settings'],
  ])('resolves ?tab=%s to the %s area', (tab, area) => {
    const location = resolveMembersAdminLocation(tab, membersAdminAreasFor(allowAll));
    expect(location.tab).toBe(tab);
    expect(location.area.id).toBe(area);
  });

  it.each([null, '', 'unknown'])('opens Member Management for a tab of %p', (tab) => {
    const location = resolveMembersAdminLocation(tab, membersAdminAreasFor(allowAll));
    expect(location.tab).toBe('manage');
    expect(location.area.id).toBe('roster');
  });

  it('sends a tab the member cannot open to Member Management', () => {
    const location = resolveMembersAdminLocation('add', membersAdminAreasFor(allowNone));
    expect(location.tab).toBe('manage');
    expect(location.area.id).toBe('roster');
  });
});
