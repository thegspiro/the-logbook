/**
 * The QuickBooks Online connection card (owner decision 2026-11-01): says when
 * the server has no Intuit app, connects through Intuit's consent page, shows
 * each payment as accepted, waiting or refused, and offers the actions only to
 * a finance manager. What posts is the backend's decision; the card reports it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockConnection = vi.fn();
const mockPostings = vi.fn();
const mockStartConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSyncNow = vi.fn();
const mockRetry = vi.fn();
vi.mock('../services/api', () => ({
  quickBooksOnlineService: {
    connection: (...args: unknown[]) => mockConnection(...args) as unknown,
    postings: (...args: unknown[]) => mockPostings(...args) as unknown,
    startConnect: (...args: unknown[]) => mockStartConnect(...args) as unknown,
    disconnect: (...args: unknown[]) => mockDisconnect(...args) as unknown,
    syncNow: (...args: unknown[]) => mockSyncNow(...args) as unknown,
    retry: (...args: unknown[]) => mockRetry(...args) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { renderWithRouter } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { QuickBooksOnlineSection } from './QuickBooksOnlineSection';
import { QuickBooksPostingNote } from './QuickBooksPostingNote';
import type { QuickBooksConnection, QuickBooksPosting } from '../types';

const signIn = (permissions: string[]) => {
  useAuthStore.setState({ user: { id: 'u-1', permissions } as never });
};

const counts = { queued: 0, retrying: 0, posted: 0, failed: 0, superseded: 0 };

const connection = (overrides: Partial<QuickBooksConnection> = {}): QuickBooksConnection => ({
  configured: true,
  environment: 'sandbox',
  status: 'connected',
  environmentMismatch: false,
  realmId: '9130350',
  connectedAt: '2026-11-06T15:00:00Z',
  connectedByName: 'Tess Treasurer',
  postFrom: '2026-11-06T15:00:00Z',
  counts,
  ...overrides,
});

const posting = (overrides: Partial<QuickBooksPosting>): QuickBooksPosting => ({
  id: 'p-1',
  paymentType: 'purchase_request',
  paymentId: 'pr-1',
  documentNumber: 'PR-2026-0001',
  status: 'posted',
  vendorName: 'Red Cross',
  amount: '240.50',
  qbPurchaseId: '252',
  attempts: 1,
  postedAt: '2026-11-06T16:00:00Z',
  createdAt: '2026-11-06T15:30:00Z',
  ...overrides,
});

beforeEach(() => {
  for (const mock of [
    mockConnection,
    mockPostings,
    mockStartConnect,
    mockDisconnect,
    mockSyncNow,
    mockRetry,
    mockToastSuccess,
    mockToastError,
  ]) {
    mock.mockReset();
  }
  mockConnection.mockResolvedValue(connection());
  mockPostings.mockResolvedValue([]);
  mockRetry.mockResolvedValue(undefined);
  signIn(['finance.view', 'finance.manage']);
  window.history.pushState({}, '', '/finance/settings/quickbooks');
});

describe('QuickBooksOnlineSection', () => {
  it('says the server is not configured, and offers no connect', async () => {
    mockConnection.mockResolvedValue(connection({ configured: false, status: 'disconnected', environment: null }));
    renderWithRouter(<QuickBooksOnlineSection />);

    expect(await screen.findByText(/Not configured on this server/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect to QuickBooks/ })).not.toBeInTheDocument();
    expect(mockPostings).not.toHaveBeenCalled();
  });

  it("sends the browser to Intuit's consent page to connect", async () => {
    mockConnection.mockResolvedValue(connection({ status: 'disconnected', realmId: null, connectedAt: null }));
    mockStartConnect.mockResolvedValue('https://appcenter.intuit.com/connect/oauth2?state=s');
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    try {
      renderWithRouter(<QuickBooksOnlineSection />);
      await userEvent.click(await screen.findByRole('button', { name: 'Connect to QuickBooks' }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://appcenter.intuit.com/connect/oauth2?state=s'));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('lists each payment as accepted, waiting or refused, and resends a refused one', async () => {
    mockPostings.mockResolvedValue([
      posting({}),
      posting({
        id: 'p-2',
        documentNumber: 'CR-2026-0001',
        status: 'failed',
        qbPurchaseId: null,
        postedAt: null,
        lastError: "'Operating Visa' is not a Bank account in QuickBooks",
      }),
      posting({ id: 'p-3', documentNumber: 'ER-2026-0001', status: 'retrying', qbPurchaseId: null, postedAt: null }),
    ]);
    renderWithRouter(<QuickBooksOnlineSection />);

    await screen.findByText('PR-2026-0001');
    const accepted = screen.getByRole('row', { name: /PR-2026-0001/ });
    expect(within(accepted).getByText('Accepted by QuickBooks')).toBeInTheDocument();
    expect(within(accepted).getByText(/QuickBooks #252/)).toBeInTheDocument();
    const refused = screen.getByRole('row', { name: /CR-2026-0001/ });
    expect(within(refused).getByText('Refused by QuickBooks')).toBeInTheDocument();
    expect(within(refused).getByText(/is not a Bank account/)).toBeInTheDocument();
    const waiting = screen.getByRole('row', { name: /ER-2026-0001/ });
    expect(within(waiting).getByText('Retrying')).toBeInTheDocument();

    await userEvent.click(within(refused).getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith('p-2'));
  });

  it('offers a finance viewer the list but none of the actions', async () => {
    signIn(['finance.view']);
    mockPostings.mockResolvedValue([posting({ status: 'failed', lastError: 'Refused' })]);
    renderWithRouter(<QuickBooksOnlineSection />);

    expect(await screen.findByText('PR-2026-0001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send again|Post now|Disconnect/ })).not.toBeInTheDocument();
  });

  it('asks before disconnecting, and keeps the connection when told to', async () => {
    renderWithRouter(<QuickBooksOnlineSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stay connected' }));

    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it('asks for reconnecting when QuickBooks stopped accepting the connection', async () => {
    mockConnection.mockResolvedValue(
      connection({ status: 'reconnect_required', lastError: 'QuickBooks refused the sign-in; connect again' })
    );
    renderWithRouter(<QuickBooksOnlineSection />);

    expect(await screen.findByText('QuickBooks refused the sign-in; connect again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect to QuickBooks' })).toBeInTheDocument();
  });

  it("explains a refused connect from the callback's redirect", async () => {
    window.history.pushState({}, '', '/finance/settings/quickbooks?quickbooks_error=invalid_state');
    renderWithRouter(<QuickBooksOnlineSection />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be verified/);
  });
});

describe('QuickBooksPostingNote', () => {
  it('says a payment was accepted by QuickBooks, with its record number', async () => {
    mockPostings.mockResolvedValue([posting({})]);
    renderWithRouter(<QuickBooksPostingNote paymentType="purchase_request" paymentId="pr-1" />);

    expect(await screen.findByText(/Accepted by QuickBooks/)).toHaveTextContent('(#252)');
    expect(mockPostings).toHaveBeenCalledWith({ paymentType: 'purchase_request', paymentId: 'pr-1' });
  });

  it('shows nothing for a payment never sent live, and asks nothing without finance.view', async () => {
    signIn(['finance.manage']);
    const { container } = renderWithRouter(<QuickBooksPostingNote paymentType="check_request" paymentId="cr-1" />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockPostings).not.toHaveBeenCalled();
  });
});
