import { describe, it, expect } from 'vitest';
import { actionItemStatusLabel } from './actionItemStatus';

describe('actionItemStatusLabel', () => {
  it('names the statuses of both meeting and minutes action items', () => {
    expect(actionItemStatusLabel('open')).toBe('Open');
    expect(actionItemStatusLabel('pending')).toBe('Pending');
    expect(actionItemStatusLabel('in_progress')).toBe('In progress');
    expect(actionItemStatusLabel('overdue')).toBe('Overdue');
  });

  it('reads an unknown status as itself, every underscore replaced', () => {
    expect(actionItemStatusLabel('waiting_on_vendor_reply')).toBe('waiting on vendor reply');
  });
});
