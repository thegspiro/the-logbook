import { describe, it, expect, vi, afterEach } from 'vitest';
import { newAgendaItemKey } from './agendaItemKey';

// What the server accepts for an agenda item key.
const accepted = /^[a-z0-9][a-z0-9_-]{0,49}$/;

describe('newAgendaItemKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is accepted by the server', () => {
    for (let n = 0; n < 50; n += 1) expect(newAgendaItemKey(new Set())).toMatch(accepted);
  });

  it('does not hand out the same key twice in a row', () => {
    const keys = new Set<string>();
    for (let n = 0; n < 200; n += 1) keys.add(newAgendaItemKey(keys));
    expect(keys.size).toBe(200);
  });

  it('skips a key already on the agenda', () => {
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValueOnce(0.123456789).mockReturnValueOnce(0.987654321);
    const first = newAgendaItemKey(new Set());
    random.mockReset();
    random.mockReturnValueOnce(0.123456789).mockReturnValueOnce(0.987654321);
    const second = newAgendaItemKey(new Set([first]));
    expect(second).not.toBe(first);
    expect(second).toMatch(accepted);
  });
});
