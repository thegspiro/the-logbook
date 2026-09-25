import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastFn } = vi.hoisted(() => {
  const fn = vi.fn() as ReturnType<typeof vi.fn> & {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  fn.success = vi.fn();
  fn.error = vi.fn();
  return { toastFn: fn };
});
vi.mock('react-hot-toast', () => ({ default: toastFn }));

import {
  AUDIT_REPLAY_URL,
  PUT_AWAY_REPLAY_URL,
  auditReplayItem,
  describeNfcSync,
  newOfflineId,
  putAwaySessionItem,
  replayTap,
} from './nfcOfflineSync';

const step = (over: Record<string, unknown>) => ({
  index: 0,
  outcome: 'moved',
  item_id: null,
  item_name: null,
  storage_area_name: null,
  message: null,
  ...over,
});

describe('nfcOfflineSync', () => {
  beforeEach(() => {
    toastFn.mockReset();
    toastFn.success.mockReset();
    toastFn.error.mockReset();
  });

  describe('queue entries', () => {
    it('keeps only the raw read, and omits what was not read', () => {
      expect(replayTap(null, '04A2245B')).toEqual({ code: undefined, serial_number: '04A2245B' });
      expect(replayTap('INVT1', '')).toEqual({ code: 'INVT1', serial_number: undefined });
    });

    it('makes ids the audit replay accepts as a submission id', () => {
      expect(newOfflineId('audit')).toMatch(/^audit-[A-Za-z0-9]{8,}$/);
      expect(newOfflineId('audit')).not.toBe(newOfflineId('audit'));
    });

    it('holds a put-away session while it is written', () => {
      const item = putAwaySessionItem('s-1', { taps: [{ serial_number: 'A' }, { serial_number: 'B' }] }, 5);
      expect(item).toMatchObject({
        id: 's-1',
        kind: 'nfc-put-away',
        url: PUT_AWAY_REPLAY_URL,
        held: true,
        queuedAt: 5,
        label: 'Put away: 2 taps',
      });
    });

    it('files an audit under its own submission id, ready to send', () => {
      const item = auditReplayItem({ client_submission_id: 'audit-abcdef12', tapped: [], taps: [] }, 'Shelf A');
      expect(item).toMatchObject({ id: 'audit-abcdef12', url: AUDIT_REPLAY_URL, label: 'Shelf audit: Shelf A' });
      expect(item.held).toBeUndefined();
    });
  });

  describe('describeNfcSync', () => {
    it('reports an offline put-away that moved everything', () => {
      describeNfcSync('nfc-put-away', {
        results: [step({ outcome: 'moved', item_name: 'Helmet' })],
        moved_count: 1,
        refused_count: 0,
        unread_count: 0,
        held_item_name: null,
      });
      expect(toastFn.success).toHaveBeenCalledWith('Offline put-away applied: 1 put away.');
    });

    it('names what was not moved, so a refusal is not lost with the screen', () => {
      describeNfcSync('nfc-put-away', {
        results: [
          step({ outcome: 'refused', item_name: 'Coat 9' }),
          step({ outcome: 'refused', item_name: 'Coat 10' }),
          step({ outcome: 'refused', item_name: 'Coat 11' }),
          step({ outcome: 'refused', item_name: 'Coat 12' }),
          step({ outcome: 'unread' }),
        ],
        moved_count: 0,
        refused_count: 4,
        unread_count: 1,
        held_item_name: 'Radio 7',
      });
      const message = toastFn.error.mock.calls[0]?.[0] as string;
      expect(message).toContain('0 put away, 1 tag not recognized');
      expect(message).toContain('Coat 9, Coat 10, Coat 11 and 1 more');
      expect(toastFn).toHaveBeenCalledWith(expect.stringContaining('Radio 7'), expect.anything());
    });

    it('reports a saved offline audit with what it found', () => {
      describeNfcSync('nfc-shelf-audit', {
        audit: { storage_area_name: 'Shelf A', found_count: 3, missing_count: 1, unexpected_count: 0 },
        not_saved_reason: null,
        unread_count: 2,
        other_shelf_count: 0,
      });
      expect(toastFn.success.mock.calls[0]?.[0]).toBe(
        'Offline audit of Shelf A saved: 3 found, 1 missing, 0 unexpected (2 tags not recognized).'
      );
    });

    it('says why an offline audit could not be saved', () => {
      describeNfcSync('nfc-shelf-audit', {
        audit: null,
        not_saved_reason: 'No shelf was chosen or tapped, so there was nothing to audit.',
        unread_count: 0,
        other_shelf_count: 0,
      });
      expect(toastFn.error.mock.calls[0]?.[0]).toContain('No shelf was chosen');
    });

    it('says nothing for other queues', () => {
      describeNfcSync('training-submission', { id: 's-1' });
      expect(toastFn).not.toHaveBeenCalled();
      expect(toastFn.success).not.toHaveBeenCalled();
      expect(toastFn.error).not.toHaveBeenCalled();
    });
  });
});
