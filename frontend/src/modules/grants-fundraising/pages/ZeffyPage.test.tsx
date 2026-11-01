/**
 * The Zeffy page: who sees what, and what a link sends.
 *
 * The start date is the guard against counting money twice, so the payload
 * is asserted exactly: a blank date omits `applyFrom` (the backend reads that
 * as "from now on"), a chosen date sends the department's local midnight, and
 * re-saving an existing link without touching the date leaves it alone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import type { ZeffyCampaign, ZeffyPayment, ZeffyStatus } from '../types';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p) }),
}));

const getStatus = vi.fn();
const listZeffyCampaigns = vi.fn();
const listLinks = vi.fn();
const saveLink = vi.fn();
const deleteLink = vi.fn();
const listPayments = vi.fn();
const syncNow = vi.fn();
const listDuesSchedules = vi.fn();
const listCampaigns = vi.fn();
const listEvents = vi.fn();
vi.mock('../services/api', () => ({
  zeffyService: {
    getStatus: (...args: unknown[]) => getStatus(...args) as unknown,
    listCampaigns: (...args: unknown[]) => listZeffyCampaigns(...args) as unknown,
    listLinks: (...args: unknown[]) => listLinks(...args) as unknown,
    saveLink: (...args: unknown[]) => saveLink(...args) as unknown,
    deleteLink: (...args: unknown[]) => deleteLink(...args) as unknown,
    listPayments: (...args: unknown[]) => listPayments(...args) as unknown,
    syncNow: (...args: unknown[]) => syncNow(...args) as unknown,
    listDuesSchedules: (...args: unknown[]) => listDuesSchedules(...args) as unknown,
  },
  fundraisingService: {
    listCampaigns: (...args: unknown[]) => listCampaigns(...args) as unknown,
    listFundraisingEvents: (...args: unknown[]) => listEvents(...args) as unknown,
  },
}));

import ZeffyPage from './ZeffyPage';

const connected: ZeffyStatus = {
  connected: true,
  integrationId: 'int-1',
  webhookConfigured: false,
  lastSyncAt: null,
  stateCounts: { needs_review: 1, unmatched: 2 },
};

const zeffyCampaign = (overrides: Partial<ZeffyCampaign> = {}): ZeffyCampaign => ({
  id: 'zc-1',
  title: 'Engine Fund Drive',
  campaignType: 'donation_form',
  category: 'donation',
  status: 'active',
  url: 'https://zeffy.example/c/1',
  isArchived: false,
  raised: '1250.00',
  currency: 'usd',
  link: null,
  ...overrides,
});

const payment = (overrides: Partial<ZeffyPayment> = {}): ZeffyPayment => ({
  id: 'row-1',
  zeffyPaymentId: 'pay_1',
  zeffyCampaignId: 'zc-1',
  campaignTitle: 'Engine Fund Drive',
  campaignCategory: 'donation',
  paymentType: 'online',
  zeffyStatus: 'succeeded',
  refundStatus: 'none',
  amount: '50.00',
  refundedAmount: '0.00',
  currency: 'USD',
  ticketCount: 0,
  paidAt: '2026-10-01T12:00:00Z',
  payerName: 'Pat Donor',
  receiptUrl: null,
  state: 'unmatched',
  stateDetail: 'No member has the email address the payer used.',
  appliedTargetType: null,
  donationId: null,
  fundraisingEventId: null,
  memberDuesId: null,
  appliedAmount: '0.00',
  updatedAt: '2026-10-01T12:00:00Z',
  ...overrides,
});

const resetMocks = () => {
  for (const mock of [
    getStatus,
    listZeffyCampaigns,
    listLinks,
    saveLink,
    deleteLink,
    listPayments,
    syncNow,
    listDuesSchedules,
    listCampaigns,
    listEvents,
    toastError,
    toastSuccess,
  ]) {
    mock.mockReset();
  }
  getStatus.mockResolvedValue(connected);
  listZeffyCampaigns.mockResolvedValue([zeffyCampaign()]);
  listLinks.mockResolvedValue([]);
  saveLink.mockResolvedValue({});
  deleteLink.mockResolvedValue(undefined);
  listPayments.mockResolvedValue({ items: [payment()], total: 1 });
  syncNow.mockResolvedValue({ links: 1, paymentsRead: 3, retriedApplied: 0, complete: true, rateLimited: false });
  listDuesSchedules.mockResolvedValue([{ id: 'ds-1', name: 'Annual dues', isActive: true }]);
  listCampaigns.mockResolvedValue([{ id: 'fc-1', name: 'Engine fund' }]);
  listEvents.mockResolvedValue([{ id: 'fe-1', name: 'Pancake breakfast' }]);
};

describe('ZeffyPage — a fundraising manager', () => {
  beforeEach(() => {
    resetMocks();
    granted = new Set(['fundraising.view', 'fundraising.manage']);
  });

  it('links a campaign from now on when no start date is chosen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Link Engine Fund Drive' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Fundraising campaign'), 'fc-1');
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    await waitFor(() =>
      expect(saveLink).toHaveBeenCalledWith('zc-1', {
        targetType: 'fundraising_campaign',
        targetId: 'fc-1',
        zeffyCampaignTitle: 'Engine Fund Drive',
        applyFrom: undefined,
      })
    );
  });

  it('sends a chosen start date as local midnight', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Link Engine Fund Drive' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Fundraising campaign'), 'fc-1');
    await user.type(within(dialog).getByLabelText(/Apply payments made on or after/), '2026-09-01');
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(saveLink).toHaveBeenCalledTimes(1));
    expect(saveLink.mock.calls[0]?.[1]).toMatchObject({ applyFrom: '2026-09-01T00:00:00.000Z' });
  });

  it('does not move an existing link’s start when the date is untouched', async () => {
    listZeffyCampaigns.mockResolvedValue([
      zeffyCampaign({
        link: {
          id: 'l-1',
          zeffyCampaignId: 'zc-1',
          targetType: 'fundraising_campaign',
          targetId: 'fc-1',
          targetName: 'Engine fund',
          applyFrom: '2026-10-15T14:30:00Z',
          createdAt: '2026-10-15T14:30:00Z',
          updatedAt: '2026-10-15T14:30:00Z',
        },
      }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Change link for Engine Fund Drive' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(saveLink).toHaveBeenCalledTimes(1));
    expect(saveLink.mock.calls[0]?.[1]).toMatchObject({ targetId: 'fc-1', applyFrom: undefined });
  });

  it('refuses to save without a record chosen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Link Engine Fund Drive' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose the fundraising campaign to link.');
    expect(saveLink).not.toHaveBeenCalled();
  });

  it('does not offer member dues without finance.manage', async () => {
    listZeffyCampaigns.mockResolvedValue([zeffyCampaign({ category: 'membership', title: 'Memberships' })]);
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Link Memberships' }));
    const dialog = await screen.findByRole('dialog');
    const kinds = within(dialog).getByLabelText('Record payments as');
    expect(within(kinds).queryByRole('option', { name: 'Member dues' })).not.toBeInTheDocument();
    expect(listDuesSchedules).not.toHaveBeenCalled();
  });

  it('defaults a membership campaign to member dues for a finance manager', async () => {
    granted.add('finance.manage');
    granted.add('finance.view');
    listZeffyCampaigns.mockResolvedValue([zeffyCampaign({ category: 'membership', title: 'Memberships' })]);
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Link Memberships' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Record payments as')).toHaveValue('dues_schedule');
    await user.selectOptions(within(dialog).getByLabelText('Member dues'), 'ds-1');
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(saveLink).toHaveBeenCalledTimes(1));
    expect(saveLink.mock.calls[0]?.[1]).toMatchObject({ targetType: 'dues_schedule', targetId: 'ds-1' });
  });

  const duesLinked = () =>
    zeffyCampaign({
      category: 'membership',
      title: 'Memberships',
      link: {
        id: 'l-2',
        zeffyCampaignId: 'zc-1',
        targetType: 'dues_schedule',
        targetId: 'ds-1',
        targetName: 'Annual dues',
        applyFrom: '2026-10-15T14:30:00Z',
        createdAt: '2026-10-15T14:30:00Z',
        updatedAt: '2026-10-15T14:30:00Z',
      },
    });

  it('does not offer to change or unlink a dues link without finance.manage', async () => {
    listZeffyCampaigns.mockResolvedValue([duesLinked()]);
    renderWithRouter(<ZeffyPage />);

    expect(await screen.findByText('Changing a member dues link needs finance access.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change link for Memberships' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlink Memberships' })).not.toBeInTheDocument();
  });

  it('lets a finance manager change a dues link', async () => {
    granted.add('finance.manage');
    granted.add('finance.view');
    listZeffyCampaigns.mockResolvedValue([duesLinked()]);
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Change link for Memberships' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Record payments as')).toHaveValue('dues_schedule');
    expect(within(dialog).getByLabelText('Member dues')).toHaveValue('ds-1');
    expect(screen.queryByText('Changing a member dues link needs finance access.')).not.toBeInTheDocument();
  });

  it('does not offer member dues to a finance manager who cannot read the schedules', async () => {
    granted.add('finance.manage');
    listZeffyCampaigns.mockResolvedValue([zeffyCampaign({ category: 'membership', title: 'Memberships' })]);
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Link Memberships' }));
    const kinds = within(await screen.findByRole('dialog')).getByLabelText('Record payments as');
    expect(within(kinds).queryByRole('option', { name: 'Member dues' })).not.toBeInTheDocument();
    expect(listDuesSchedules).not.toHaveBeenCalled();
  });

  it('sends the current time when an existing start date is cleared', async () => {
    listZeffyCampaigns.mockResolvedValue([
      zeffyCampaign({
        link: {
          id: 'l-1',
          zeffyCampaignId: 'zc-1',
          targetType: 'fundraising_campaign',
          targetId: 'fc-1',
          targetName: 'Engine fund',
          applyFrom: '2025-01-01T00:00:00Z',
          createdAt: '2026-10-15T14:30:00Z',
          updatedAt: '2026-10-15T14:30:00Z',
        },
      }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Change link for Engine Fund Drive' }));
    const dialog = await screen.findByRole('dialog');
    const before = Date.now();
    await user.clear(within(dialog).getByLabelText(/Apply payments made on or after/));
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(saveLink).toHaveBeenCalledTimes(1));
    const sent = (saveLink.mock.calls[0]?.[1] as { applyFrom?: string }).applyFrom;
    expect(sent).toBeDefined();
    expect(Date.parse(sent ?? '')).toBeGreaterThanOrEqual(before - 1000);
  });

  it('shows a failure to load the linkable records, with a retry', async () => {
    listCampaigns.mockRejectedValueOnce(new Error('Service unavailable'));
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    const retry = await screen.findByRole('button', { name: 'Retry' });
    await user.click(retry);

    await waitFor(() => expect(listCampaigns).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument());
  });

  it('labels an amount that is not in US dollars', async () => {
    listPayments.mockResolvedValue({ items: [payment({ currency: 'CAD', amount: '50.00' })], total: 1 });
    listZeffyCampaigns.mockResolvedValue([zeffyCampaign({ currency: 'cad' })]);
    renderWithRouter(<ZeffyPage />);

    expect(await within(await screen.findByRole('table')).findByText('$50.00 CAD')).toBeInTheDocument();
    expect(await screen.findByText(/Raised \$1,250\.00 CAD/)).toBeInTheDocument();
  });

  it('asks before unlinking', async () => {
    listZeffyCampaigns.mockResolvedValue([
      zeffyCampaign({
        link: {
          id: 'l-1',
          zeffyCampaignId: 'zc-1',
          targetType: 'fundraising_event',
          targetId: 'fe-1',
          targetName: 'Pancake breakfast',
          applyFrom: '2026-10-15T14:30:00Z',
          createdAt: '2026-10-15T14:30:00Z',
          updatedAt: '2026-10-15T14:30:00Z',
        },
      }),
    ]);
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: 'Unlink Engine Fund Drive' }));
    await user.click(await screen.findByRole('button', { name: 'Unlink' }));

    await waitFor(() => expect(deleteLink).toHaveBeenCalledWith('zc-1'));
  });

  it('runs a sync and reloads the payments', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);

    await user.click(await screen.findByRole('button', { name: /Sync now/ }));

    await waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Read 3 payments from Zeffy'));
    expect(listPayments.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('points to the Integrations page when Zeffy is not connected', async () => {
    getStatus.mockResolvedValue({ ...connected, connected: false });
    renderWithRouter(<ZeffyPage />);

    expect(await screen.findByRole('link', { name: 'Integrations page' })).toHaveAttribute('href', '/integrations');
    expect(screen.queryByRole('button', { name: /Sync now/ })).not.toBeInTheDocument();
    expect(listZeffyCampaigns).not.toHaveBeenCalled();
  });
});

describe('ZeffyPage — a member who can only view fundraising', () => {
  beforeEach(() => {
    resetMocks();
    granted = new Set(['fundraising.view']);
    listLinks.mockResolvedValue([
      {
        id: 'l-1',
        zeffyCampaignId: 'zc-1',
        zeffyCampaignTitle: 'Engine Fund Drive',
        targetType: 'fundraising_campaign',
        targetId: 'fc-1',
        targetName: 'Engine fund',
        applyFrom: '2026-10-15T14:30:00Z',
        createdAt: '2026-10-15T14:30:00Z',
        updatedAt: '2026-10-15T14:30:00Z',
      },
    ]);
  });

  it('sees the links and payments but nothing that calls Zeffy or changes a link', async () => {
    renderWithRouter(<ZeffyPage />);

    expect(await screen.findByText('Linked campaigns')).toBeInTheDocument();
    expect(screen.getByText(/Fundraising campaign: Engine fund/)).toBeInTheDocument();
    expect(await screen.findByText('Pat Donor')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('No member match')).toBeInTheDocument();
    expect(within(table).getByText('No member has the email address the payer used.')).toBeInTheDocument();
    expect(listZeffyCampaigns).not.toHaveBeenCalled();
    expect(listCampaigns).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Sync now/ })).not.toBeInTheDocument();
  });

  it('filters payments by state and starts from the first page', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ZeffyPage />);
    await screen.findByText('Pat Donor');

    await user.click(screen.getByRole('button', { name: 'Needs review' }));

    await waitFor(() => expect(listPayments).toHaveBeenLastCalledWith({ state: 'needs_review', limit: 50, offset: 0 }));
  });
});
