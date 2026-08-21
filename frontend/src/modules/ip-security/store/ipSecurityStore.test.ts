import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IPException, CountryBlockRule } from '../types';

const mockGetMyExceptions = vi.fn();
const mockGetPendingExceptions = vi.fn();
const mockGetAllExceptions = vi.fn();
const mockGetBlockedAttempts = vi.fn();
const mockGetBlockedCountries = vi.fn();
const mockGetExceptionAuditLog = vi.fn();
const mockRequestException = vi.fn();
const mockApproveException = vi.fn();
const mockRejectException = vi.fn();
const mockRevokeException = vi.fn();
const mockAddBlockedCountry = vi.fn();
const mockRemoveBlockedCountry = vi.fn();

vi.mock('../services/api', () => ({
  ipSecurityService: {
    getMyExceptions: (...a: unknown[]) => mockGetMyExceptions(...a) as unknown,
    getPendingExceptions: (...a: unknown[]) => mockGetPendingExceptions(...a) as unknown,
    getAllExceptions: (...a: unknown[]) => mockGetAllExceptions(...a) as unknown,
    getBlockedAttempts: (...a: unknown[]) => mockGetBlockedAttempts(...a) as unknown,
    getBlockedCountries: (...a: unknown[]) => mockGetBlockedCountries(...a) as unknown,
    getExceptionAuditLog: (...a: unknown[]) => mockGetExceptionAuditLog(...a) as unknown,
    requestException: (...a: unknown[]) => mockRequestException(...a) as unknown,
    approveException: (...a: unknown[]) => mockApproveException(...a) as unknown,
    rejectException: (...a: unknown[]) => mockRejectException(...a) as unknown,
    revokeException: (...a: unknown[]) => mockRevokeException(...a) as unknown,
    addBlockedCountry: (...a: unknown[]) => mockAddBlockedCountry(...a) as unknown,
    removeBlockedCountry: (...a: unknown[]) => mockRemoveBlockedCountry(...a) as unknown,
  },
}));

// Import the store AFTER the service mock is in place.
import { useIPSecurityStore } from './ipSecurityStore';

function exception(id: string, over: Partial<IPException> = {}): IPException {
  return {
    id,
    ipAddress: '203.0.113.7',
    exceptionType: 'country_block',
    reason: 'deployed overseas',
    userId: 'u-1',
    organizationId: 'org-1',
    requestedDurationDays: 30,
    validUntil: '2026-09-16T00:00:00Z',
    approvalStatus: 'pending',
    requestedBy: 'u-1',
    ...over,
  };
}

function country(code: string): CountryBlockRule {
  return { countryCode: code, countryName: code } as CountryBlockRule;
}

const INITIAL = {
  myExceptions: [],
  pendingExceptions: [],
  allExceptions: [],
  allExceptionsTotal: 0,
  blockedAttempts: [],
  blockedAttemptsTotal: 0,
  blockedCountries: [],
  auditLog: [],
  isLoading: false,
  isSaving: false,
  error: null,
  activeTab: 'pending' as const,
};

const store = () => useIPSecurityStore.getState();

describe('ipSecurityStore', () => {
  beforeEach(() => {
    useIPSecurityStore.setState(INITIAL);
    vi.clearAllMocks();
  });

  describe('fetches', () => {
    it('loads the caller’s own exceptions, excluding expired ones by default', async () => {
      mockGetMyExceptions.mockResolvedValue([exception('e-1')]);

      await store().fetchMyExceptions();

      // The service takes a required boolean; the store supplies the default so
      // an omitted argument cannot reach it as undefined.
      expect(mockGetMyExceptions).toHaveBeenCalledWith(false);
      expect(store().myExceptions).toHaveLength(1);
      expect(store().isLoading).toBe(false);
    });

    it('passes the include-expired flag through when asked', async () => {
      mockGetMyExceptions.mockResolvedValue([]);

      await store().fetchMyExceptions(true);

      expect(mockGetMyExceptions).toHaveBeenCalledWith(true);
    });

    it('loads the pending approval queue', async () => {
      mockGetPendingExceptions.mockResolvedValue([exception('e-1'), exception('e-2')]);

      await store().fetchPendingExceptions();

      expect(store().pendingExceptions).toHaveLength(2);
    });

    // These two set a list AND its total from one response, so a paginated
    // table can show "showing 50 of 900" without a second request.
    it('records the total alongside the page of exceptions', async () => {
      mockGetAllExceptions.mockResolvedValue({ items: [exception('e-1')], total: 900 });

      await store().fetchAllExceptions('approved', 50, 100);

      expect(mockGetAllExceptions).toHaveBeenCalledWith('approved', 50, 100);
      expect(store().allExceptions).toHaveLength(1);
      expect(store().allExceptionsTotal).toBe(900);
    });

    it('defaults the exception page window to the first 50', async () => {
      mockGetAllExceptions.mockResolvedValue({ items: [], total: 0 });

      await store().fetchAllExceptions();

      expect(mockGetAllExceptions).toHaveBeenCalledWith(undefined, 50, 0);
    });

    it('records the total alongside the page of blocked attempts', async () => {
      mockGetBlockedAttempts.mockResolvedValue({ items: [{ id: 'b-1' }], total: 12 });

      await store().fetchBlockedAttempts(25, 25, 'RU');

      expect(mockGetBlockedAttempts).toHaveBeenCalledWith(25, 25, 'RU');
      expect(store().blockedAttemptsTotal).toBe(12);
    });

    it('defaults the blocked-attempt page window to the first 50', async () => {
      mockGetBlockedAttempts.mockResolvedValue({ items: [], total: 0 });

      await store().fetchBlockedAttempts();

      expect(mockGetBlockedAttempts).toHaveBeenCalledWith(50, 0, undefined);
    });

    it('loads the country block list', async () => {
      mockGetBlockedCountries.mockResolvedValue([country('RU')]);

      await store().fetchBlockedCountries();

      expect(store().blockedCountries).toEqual([country('RU')]);
    });

    it('loads the audit trail for one exception', async () => {
      mockGetExceptionAuditLog.mockResolvedValue([{ id: 'a-1' }]);

      await store().fetchAuditLog('e-1');

      expect(mockGetExceptionAuditLog).toHaveBeenCalledWith('e-1');
      expect(store().auditLog).toHaveLength(1);
    });
  });

  // An approval decision must leave the queue immediately, or a second reviewer
  // acts on a request the first already decided.
  describe('approval workflow', () => {
    beforeEach(() => {
      useIPSecurityStore.setState({
        pendingExceptions: [exception('e-1'), exception('e-2')],
        allExceptions: [exception('e-1'), exception('e-2')],
      });
    });

    it('drops an approved request from the queue and updates it in the full list', async () => {
      const approved = exception('e-1', { approvalStatus: 'approved', approvedBy: 'chief' });
      mockApproveException.mockResolvedValue(approved);

      await store().approveException('e-1', { approvedDurationDays: 14 });

      expect(mockApproveException).toHaveBeenCalledWith('e-1', { approvedDurationDays: 14 });
      expect(store().pendingExceptions.map((e) => e.id)).toEqual(['e-2']);
      expect(store().allExceptions.find((e) => e.id === 'e-1')?.approvalStatus).toBe('approved');
      expect(store().isSaving).toBe(false);
    });

    it('drops a rejected request from the queue and updates it in the full list', async () => {
      const rejected = exception('e-1', { approvalStatus: 'rejected' });
      mockRejectException.mockResolvedValue(rejected);

      await store().rejectException('e-1', { rejectionReason: 'not justified' });

      expect(store().pendingExceptions.map((e) => e.id)).toEqual(['e-2']);
      expect(store().allExceptions.find((e) => e.id === 'e-1')?.approvalStatus).toBe('rejected');
    });

    it('leaves the other queued requests untouched', async () => {
      mockApproveException.mockResolvedValue(exception('e-1', { approvalStatus: 'approved' }));

      await store().approveException('e-1', {});

      expect(store().allExceptions.find((e) => e.id === 'e-2')?.approvalStatus).toBe('pending');
    });

    // Revoking acts on an already-approved exception, so there is nothing in the
    // pending queue to remove — touching it would drop an unrelated request.
    it('revokes without disturbing the pending queue', async () => {
      const revoked = exception('e-1', { approvalStatus: 'revoked' });
      mockRevokeException.mockResolvedValue(revoked);

      await store().revokeException('e-1', { revokeReason: 'member left' });

      expect(store().allExceptions.find((e) => e.id === 'e-1')?.approvalStatus).toBe('revoked');
      expect(store().pendingExceptions.map((e) => e.id)).toEqual(['e-1', 'e-2']);
    });

    // A failed decision must not look like it succeeded: the request stays in
    // the queue and the caller is told, so the reviewer can retry.
    it.each([
      ['approveException', mockApproveException],
      ['rejectException', mockRejectException],
      ['revokeException', mockRevokeException],
    ] as const)('surfaces a failed %s and keeps the queue intact', async (name, mockFn) => {
      mockFn.mockRejectedValue(new Error('403 Forbidden'));

      await expect((store()[name] as (id: string, data: object) => Promise<void>)('e-1', {})).rejects.toThrow();

      // The server's own message reaches the reviewer; the fallback is only for
      // a rejection that carries none.
      expect(store().error).toBe('403 Forbidden');
      expect(store().isSaving).toBe(false);
      expect(store().pendingExceptions).toHaveLength(2);
      expect(store().allExceptions.find((e) => e.id === 'e-1')?.approvalStatus).toBe('pending');
    });
  });

  describe('requesting an exception', () => {
    it('puts the new request at the top of the caller’s list', async () => {
      useIPSecurityStore.setState({ myExceptions: [exception('old')] });
      mockRequestException.mockResolvedValue(exception('new'));

      const returned = await store().requestException({
        ipAddress: '203.0.113.7',
        reason: 'deployed overseas',
        requestedDurationDays: 30,
        useCase: 'travel',
      });

      expect(returned.id).toBe('new');
      expect(store().myExceptions.map((e) => e.id)).toEqual(['new', 'old']);
      expect(store().isSaving).toBe(false);
    });

    it('reports a rejected request rather than adding it', async () => {
      useIPSecurityStore.setState({ myExceptions: [exception('old')] });
      mockRequestException.mockRejectedValue(new Error('422 invalid address'));

      await expect(
        store().requestException({
          ipAddress: 'not-an-ip',
          reason: 'x',
          requestedDurationDays: 30,
          useCase: 'travel',
        })
      ).rejects.toThrow();

      expect(store().myExceptions.map((e) => e.id)).toEqual(['old']);
      expect(store().error).toBe('422 invalid address');
      expect(store().isSaving).toBe(false);
    });
  });

  describe('country blocking', () => {
    it('appends a newly blocked country', async () => {
      useIPSecurityStore.setState({ blockedCountries: [country('RU')] });
      mockAddBlockedCountry.mockResolvedValue(country('KP'));

      await store().addBlockedCountry({ countryCode: 'KP' } as never);

      expect(store().blockedCountries.map((c) => c.countryCode)).toEqual(['RU', 'KP']);
    });

    // The store holds codes upper-cased, so an unblock typed in lower case has
    // to be normalised or the rule silently stays in place — the country would
    // still be blocked while the UI showed it removed.
    it('removes a country regardless of the case it was typed in', async () => {
      useIPSecurityStore.setState({ blockedCountries: [country('RU'), country('KP')] });
      mockRemoveBlockedCountry.mockResolvedValue(undefined);

      await store().removeBlockedCountry('ru');

      expect(mockRemoveBlockedCountry).toHaveBeenCalledWith('ru');
      expect(store().blockedCountries.map((c) => c.countryCode)).toEqual(['KP']);
    });

    it('keeps the country listed when the unblock fails', async () => {
      useIPSecurityStore.setState({ blockedCountries: [country('RU')] });
      mockRemoveBlockedCountry.mockRejectedValue(new Error('500 server error'));

      await expect(store().removeBlockedCountry('RU')).rejects.toThrow();

      expect(store().blockedCountries.map((c) => c.countryCode)).toEqual(['RU']);
      expect(store().error).toBe('500 server error');
    });
  });

  // Every fetch has its own catch. Testing only one leaves the rest free to
  // swallow a failure entirely.
  describe('failed fetches', () => {
    it.each([
      ['fetchAllExceptions', mockGetAllExceptions],
      ['fetchBlockedAttempts', mockGetBlockedAttempts],
      ['fetchMyExceptions', mockGetMyExceptions],
      ['fetchBlockedCountries', mockGetBlockedCountries],
      ['fetchAuditLog', mockGetExceptionAuditLog],
    ] as const)('records a failed %s and stops loading', async (name, mockFn) => {
      mockFn.mockRejectedValue(new Error('gateway timeout'));

      await (store()[name] as (...a: unknown[]) => Promise<void>)('e-1');

      // The server's own text is what surfaces — see the note below on why the
      // per-call fallback strings do not.
      expect(store().error).toBe('gateway timeout');
      expect(store().isLoading).toBe(false);
    });

    // Each fetch passes a distinct fallback ('Failed to load pending
    // exceptions', etc.), but getErrorMessage only uses a fallback when
    // toAppError yields an EMPTY message — and toAppError manufactures
    // 'An unknown error occurred' for anything it cannot parse. So a rejection
    // with no message shows the generic string, not the specific one. These two
    // pin the behaviour that actually ships rather than the intended one.
    it('shows the generic message, not the per-call fallback, for an unparseable error', async () => {
      mockGetPendingExceptions.mockRejectedValue({});

      await store().fetchPendingExceptions();

      expect(store().error).toBe('An unknown error occurred');
      expect(store().error).not.toMatch(/pending exceptions/i);
    });

    it('reaches the per-call fallback only for a literally empty message', async () => {
      mockGetPendingExceptions.mockRejectedValue(new Error(''));

      await store().fetchPendingExceptions();

      expect(store().error).toBe('Failed to load pending exceptions');
    });

    it('leaves the previous page in place when a refetch fails', async () => {
      useIPSecurityStore.setState({
        allExceptions: [exception('e-1')],
        allExceptionsTotal: 1,
      });
      mockGetAllExceptions.mockRejectedValue(new Error('network'));

      await store().fetchAllExceptions();

      expect(store().allExceptions).toHaveLength(1);
      expect(store().allExceptionsTotal).toBe(1);
    });
  });

  describe('error and UI state', () => {
    // Fetches feed a table and resolve; only mutations reject, because a failed
    // decision needs the caller to know it did not take effect.
    it('records a failed fetch without rejecting', async () => {
      mockGetPendingExceptions.mockRejectedValue(new Error('network'));

      await expect(store().fetchPendingExceptions()).resolves.toBeUndefined();

      expect(store().error).toBe('network');
      expect(store().isLoading).toBe(false);
    });

    it('raises the loading flag while a fetch is in flight', async () => {
      let release: () => void = () => undefined;
      mockGetPendingExceptions.mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve([]);
        })
      );

      const pending = store().fetchPendingExceptions();
      expect(store().isLoading).toBe(true);

      release();
      await pending;
      expect(store().isLoading).toBe(false);
    });

    it('raises the saving flag while a mutation is in flight', async () => {
      let release: () => void = () => undefined;
      mockApproveException.mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve(exception('e-1'));
        })
      );

      const pending = store().approveException('e-1', {});
      expect(store().isSaving).toBe(true);

      release();
      await pending;
      expect(store().isSaving).toBe(false);
    });

    it('clears a previous error when a new fetch starts', async () => {
      useIPSecurityStore.setState({ error: 'stale failure' });
      mockGetPendingExceptions.mockResolvedValue([]);

      await store().fetchPendingExceptions();

      expect(store().error).toBeNull();
    });

    it('clears the error on request', () => {
      useIPSecurityStore.setState({ error: 'boom' });

      store().clearError();

      expect(store().error).toBeNull();
    });

    it('tracks the selected tab', () => {
      store().setActiveTab('blocked-countries');

      expect(store().activeTab).toBe('blocked-countries');
    });
  });
});
