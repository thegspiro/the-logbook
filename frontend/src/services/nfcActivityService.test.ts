/**
 * nfcActivityService turns a 200 that is not a list into a failed load.
 *
 * A captive portal answers with its own HTML page and a 200. Passed through,
 * every caller read `.items` off it and the Card Readers page went down
 * through the ErrorBoundary; rejected here, each screen shows its own error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
  },
}));

import { nfcActivityService } from './nfcActivityService';

const calls = [
  ['listReaders', () => nfcActivityService.listReaders(), 'Unable to load card readers'],
  ['listRoomTaps', () => nfcActivityService.listRoomTaps('room-1', {}, 25, 0), 'Unable to load card taps'],
  ['listEventTaps', () => nfcActivityService.listEventTaps('evt-1', {}, 25, 0), 'Unable to load card taps'],
] as const;

describe.each(calls)('nfcActivityService.%s', (_name, call, message) => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it.each([
    ['an empty object', {}],
    ['an HTML page', '<html><body>Sign in to the network</body></html>'],
    ['null', null],
  ])('rejects %s with the screen’s message', async (_label, body) => {
    mockGet.mockResolvedValue({ data: body });
    await expect(call()).rejects.toThrow(message);
  });

  it('returns a list response unchanged', async () => {
    const body = { items: [{ id: 'x' }], total: 1, limit: 25, offset: 0 };
    mockGet.mockResolvedValue({ data: body });
    await expect(call()).resolves.toBe(body);
  });
});
