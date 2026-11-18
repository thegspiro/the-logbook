import { describe, it, expect } from 'vitest';
import { governanceNavItems } from './governanceNavigation';
import { trainingNavItems } from './trainingNavigation';

const allOn = () => true;
const minutesOff = (module: string) => module !== 'minutes';

const find = (items: { path: string }[], path: string) => items.find((item) => item.path === path);

describe('Waiver Requests in the Training group', () => {
  it('is offered to a member who decides, with what waits on them', () => {
    const item = find(trainingNavItems(true, { decides: true, pending: 3 }), '/attendance-waivers');
    expect(item).toMatchObject({ label: 'Waiver Requests', count: 3, countLabel: 'waiting on you' });
    // No permission: the route has none, and position-holders hold none.
    expect(item).not.toHaveProperty('permission');
  });

  it('is not offered to a member who decides nothing, or before the server answers', () => {
    expect(find(trainingNavItems(true, { decides: false, pending: 0 }), '/attendance-waivers')).toBeUndefined();
    expect(find(trainingNavItems(true, null), '/attendance-waivers')).toBeUndefined();
    expect(find(trainingNavItems(true), '/attendance-waivers')).toBeUndefined();
  });
});

describe('Waiver Requests in the Governance group', () => {
  it('is offered to a member who decides meeting requests', () => {
    const item = find(governanceNavItems(allOn, { decides: true, pending: 1 }), '/meetings/waiver-requests');
    expect(item).toMatchObject({ label: 'Waiver Requests', count: 1, countLabel: 'waiting on you' });
    expect(item).not.toHaveProperty('permission');
  });

  it('follows the minutes module, and the server’s answer', () => {
    expect(
      find(governanceNavItems(minutesOff, { decides: true, pending: 1 }), '/meetings/waiver-requests')
    ).toBeUndefined();
    expect(
      find(governanceNavItems(allOn, { decides: false, pending: 0 }), '/meetings/waiver-requests')
    ).toBeUndefined();
    expect(find(governanceNavItems(allOn), '/meetings/waiver-requests')).toBeUndefined();
  });
});
