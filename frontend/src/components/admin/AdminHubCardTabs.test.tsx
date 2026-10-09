import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreditCard, LayoutDashboard, Settings } from 'lucide-react';
import { AdminHubCardTabs, type AdminHubCardTab } from './AdminHubCardTabs';

type Id = 'overview' | 'payments' | 'settings';

const tabs: AdminHubCardTab<Id>[] = [
  { id: 'overview', label: 'Overview', description: 'Store status', icon: LayoutDashboard },
  { id: 'payments', label: 'Payments', description: 'Payments to match', icon: CreditCard, count: 2 },
  { id: 'settings', label: 'Settings', description: 'Methods and pricing', icon: Settings, count: 0 },
];

const onTabChange = vi.fn();

const renderTabs = (activeTab: Id = 'overview', panelsAlwaysRendered = false, showActiveDescription = true) =>
  render(
    <AdminHubCardTabs<Id>
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      label="Store sections"
      idPrefix="store"
      panelsAlwaysRendered={panelsAlwaysRendered}
      showActiveDescription={showActiveDescription}
    />
  );

describe('AdminHubCardTabs', () => {
  beforeEach(() => {
    onTabChange.mockReset();
  });

  it('names each card by its label and describes it by its line and count', () => {
    renderTabs();

    expect(screen.getByRole('tablist', { name: 'Store sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAccessibleDescription('Store status');
    expect(screen.getByRole('tab', { name: 'Payments' })).toHaveAccessibleDescription(
      'Payments to match. 2 need attention'
    );
    // A count of zero draws nothing, so a quiet section is not badged "0".
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAccessibleDescription('Methods and pricing');
    expect(screen.getByRole('tab', { name: 'Payments' })).toHaveTextContent('2');
  });

  it('marks the selected card and keeps only it in the tab order', () => {
    renderTabs('payments');

    expect(screen.getByRole('tab', { name: 'Payments' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Payments' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('tabindex', '-1');
  });

  it('points only the selected card at a panel unless every panel is rendered', () => {
    const { unmount } = renderTabs('payments');
    expect(screen.getByRole('tab', { name: 'Payments' })).toHaveAttribute('aria-controls', 'store-panel-payments');
    expect(screen.getByRole('tab', { name: 'Overview' })).not.toHaveAttribute('aria-controls');
    unmount();

    renderTabs('payments', true);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-controls', 'store-panel-overview');
  });

  it('selects a card on click', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(onTabChange).toHaveBeenCalledWith('settings');
  });

  it('moves and selects with the arrow, Home and End keys, wrapping at the ends', async () => {
    const user = userEvent.setup();
    renderTabs();

    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(onTabChange).toHaveBeenLastCalledWith('settings');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(onTabChange).toHaveBeenLastCalledWith('overview');
    await user.keyboard('{ArrowRight}');
    expect(onTabChange).toHaveBeenLastCalledWith('payments');
    await user.keyboard('{End}');
    expect(onTabChange).toHaveBeenLastCalledWith('settings');
  });

  // On a phone the cards are chips with no room for their line, so the
  // selected one is spelled out under the row instead.
  it('spells out the selected section under the row', () => {
    renderTabs('payments');

    expect(screen.getByText(/Payments to match/, { selector: 'p' })).toHaveTextContent('Payments — Payments to match');
  });

  it('leaves the line out for a caller that already says where the user is', () => {
    renderTabs('payments', false, false);

    expect(screen.queryByText(/Payments to match/, { selector: 'p' })).not.toBeInTheDocument();
  });

  it('declares the row an intentional scroll region', () => {
    renderTabs();

    expect(screen.getByRole('tablist', { name: 'Store sections' })).toHaveAttribute('data-mobile-scroll-region');
  });
});
