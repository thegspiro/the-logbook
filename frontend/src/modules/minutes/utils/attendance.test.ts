import { describe, it, expect } from 'vitest';
import { ATTENDANCE_LISTINGS, isListed, rollStatusesFor } from './attendance';

describe('attendance', () => {
  it.each(ATTENDANCE_LISTINGS)('names a proxy under the %s listing, as the server does', (listing) => {
    expect(isListed('proxy', listing)).toBe(true);
  });

  it('offers a proxy on the roll only where the department uses them', () => {
    expect(rollStatusesFor(false, 'present')).not.toContain('proxy');
    expect(rollStatusesFor(true, 'present')).toContain('proxy');
  });

  it('keeps a recorded proxy selectable after the department stops using them', () => {
    expect(rollStatusesFor(false, 'proxy')).toContain('proxy');
  });
});
