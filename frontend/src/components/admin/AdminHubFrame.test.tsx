import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus, ScanLine, Settings } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSummary = vi.fn();
vi.mock('../../services/adminHubService', () => ({
  adminHubService: {
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
  },
}));

import { renderWithRouter } from '../../test/utils';
import { AdminHubFrame } from './AdminHubFrame';
import type { AdminHubSummary } from '../../types/adminHub';

const summary: AdminHubSummary = {
  moduleKey: 'training',
  generatedAt: '2026-08-23T12:00:00Z',
  timezone: 'UTC',
  metrics: [
    { key: 'compliance_rate', label: 'Compliance', value: '87%', context: '124 of 142 members current', fixed: false },
    { key: 'hours_this_quarter', label: 'Hours this quarter', value: '1,840', context: 'Q3 2026', fixed: false },
    { key: 'active_programs', label: 'Active programs', value: '6', context: '32 enrolled', fixed: false },
    { key: 'needs_attention', label: 'Needs attention', value: '2', context: 'oldest waiting 9 days', fixed: true },
  ],
  attention: [
    {
      key: 'pending_submissions',
      title: '6 training submissions awaiting approval',
      detail: 'oldest waiting 9 days',
      actionLabel: 'Review queue',
      href: '/training/admin?page=records&tab=submissions',
      severity: 'critical',
      count: 6,
      oldestAgeDays: 9,
    },
  ],
};

describe('AdminHubFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSummary.mockResolvedValue(summary);
  });

  const renderFrame = (props: Partial<Parameters<typeof AdminHubFrame>[0]> = {}) =>
    renderWithRouter(
      <AdminHubFrame
        moduleKey="training"
        title="Training Administration"
        description="Approve hours, track certifications, run programs"
        {...props}
      >
        <p>Tab body</p>
      </AdminHubFrame>
    );

  it('asks the summary endpoint for its own module', async () => {
    renderFrame();

    await waitFor(() => {
      expect(mockGetSummary).toHaveBeenCalledWith('training');
    });
  });

  it('renders the header, the four metrics and the queue', async () => {
    renderFrame();

    expect(screen.getByRole('heading', { name: 'Training Administration' })).toBeInTheDocument();
    expect(screen.getByText('Administration')).toBeInTheDocument();

    await screen.findByText('Compliance');
    expect(screen.getByText('87%')).toBeInTheDocument();
    expect(screen.getByText('Needs attention', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review queue' })).toBeInTheDocument();
    expect(screen.getByText('Tab body')).toBeInTheDocument();
  });

  // The queue is the only thing worth a phone visit, so it outranks the metrics
  // there. Both live in one flex column and swap by CSS `order`, so a resize
  // can never leave the page rendering an order neither breakpoint asked for.
  it('puts the queue above the metrics on a phone and below them at desk width', async () => {
    renderFrame();
    await screen.findByText('Compliance');

    // Both are flex items of one column, so the swap is a CSS `order` rather
    // than a second render path that could drift from the first.
    expect(screen.getByRole('region', { name: 'Headline metrics' })).toHaveClass('order-2', 'sm:order-1');
    const queue = screen.getByRole('region', { name: 'Needs attention' });
    expect(queue).toHaveClass('order-1', 'sm:order-2');
    expect(within(queue).getByRole('link', { name: 'Review queue' })).toBeInTheDocument();
  });

  // "Never two red buttons" is the header's rule. Icon actions carry no fill,
  // so the single primary is the only thing competing for a first glance.
  it('gives the red treatment to the primary action alone', async () => {
    const onScan = vi.fn();
    const onCreate = vi.fn();
    renderFrame({
      actions: [{ key: 'scan', label: 'Scan a member ID', icon: ScanLine, onClick: onScan }],
      primaryAction: { key: 'create', label: 'Schedule Drill', icon: Plus, onClick: onCreate },
    });

    const primary = screen.getByRole('button', { name: 'Schedule Drill' });
    expect(primary).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: 'Scan a member ID' })).not.toHaveClass('btn-primary');

    await userEvent.click(primary);
    expect(onCreate).toHaveBeenCalled();
  });

  it('syncs the tab bar with the caller and keeps Settings last', async () => {
    const onTabChange = vi.fn();
    renderFrame({
      tabs: [
        { id: 'approvals', label: 'Approvals' },
        { id: 'settings', label: 'Settings' },
      ],
      activeTab: 'approvals',
      onTabChange,
    });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Approvals', 'Settings']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveClass('border-red-500');

    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(onTabChange).toHaveBeenCalledWith('settings');
  });

  // The frame summarises the work; it is not the work. A summary that cannot
  // load must not take the tab body down with it.
  it('keeps the tab body usable when the summary fails', async () => {
    mockGetSummary.mockRejectedValue(new Error('boom'));
    renderFrame();

    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByText('Tab body')).toBeInTheDocument();

    mockGetSummary.mockResolvedValue(summary);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('87%');
  });

  it('refetches when the caller bumps its refresh token', async () => {
    const { rerender } = renderFrame({ refreshToken: 0 });
    await waitFor(() => expect(mockGetSummary).toHaveBeenCalledTimes(1));

    rerender(
      <AdminHubFrame
        moduleKey="training"
        title="Training Administration"
        description="Approve hours, track certifications, run programs"
        refreshToken={1}
      >
        <p>Tab body</p>
      </AdminHubFrame>
    );

    await waitFor(() => expect(mockGetSummary).toHaveBeenCalledTimes(2));
  });

  it('shows the settings icon action it was given', async () => {
    const onSettings = vi.fn();
    renderFrame({ actions: [{ key: 'settings', label: 'Events settings', icon: Settings, onClick: onSettings }] });

    await userEvent.click(screen.getByRole('button', { name: 'Events settings' }));
    expect(onSettings).toHaveBeenCalled();
  });
});
