/**
 * The two-level hub navigation Training, Events, Members and the Department
 * Store share. Each hub's own tests drive it through the hub; these pin what
 * every hub relies on, independent of any one of them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookOpen, Inbox, ListChecks, Settings, Users } from 'lucide-react';
import { AdminHubAreaNav, type AdminHubAreaNavArea } from './AdminHubAreaNav';

interface Page {
  id: string;
  label: string;
  icon: typeof Inbox;
  hint: string;
}

const AREAS: AdminHubAreaNavArea<'records' | 'settings', Page>[] = [
  {
    id: 'records',
    label: 'Records',
    description: 'What happened, and approving it',
    icon: BookOpen,
    destinations: [
      { id: 'inbox', label: 'Inbox', icon: Inbox, hint: 'Waiting for review' },
      { id: 'people', label: 'People', icon: Users, hint: 'Everyone on the roster' },
      { id: 'rules', label: 'Rules', icon: ListChecks, hint: 'What members owe' },
    ],
  },
  {
    id: 'settings',
    label: 'Setup',
    description: 'How the hub is configured',
    icon: Settings,
    destinations: [{ id: 'config', label: 'Config', icon: Settings, hint: 'The switches' }],
  },
];

const RECORDS = AREAS[0] as (typeof AREAS)[number];

const onAreaChange = vi.fn();
const onTabChange = vi.fn();

const renderNav = (activeTab = 'inbox', attentionCounts: Record<string, number> = {}) =>
  render(
    <AdminHubAreaNav
      areas={AREAS}
      activeArea={RECORDS}
      activeTab={activeTab}
      onAreaChange={onAreaChange}
      onTabChange={onTabChange}
      attentionCounts={attentionCounts}
      hintOf={(destination) => destination.hint}
      label="Test admin areas"
      idPrefix="test-area"
      tabId={(area, tab) => `test-tab-${area}-${tab}`}
      tabPanelId={(area, tab) => `test-panel-${area}-${tab}`}
    />
  );

describe('AdminHubAreaNav', () => {
  beforeEach(() => {
    onAreaChange.mockReset();
    onTabChange.mockReset();
  });

  it('draws every area and the active area’s pages', () => {
    renderNav();

    const areas = within(screen.getByRole('tablist', { name: 'Test admin areas' })).getAllByRole('tab');
    expect(areas.map((tab) => tab.id)).toEqual(['test-area-tab-records', 'test-area-tab-settings']);
    const pages = within(screen.getByRole('tablist', { name: 'Records pages' })).getAllByRole('tab');
    expect(pages).toEqual([
      screen.getByRole('tab', { name: 'Inbox' }),
      screen.getByRole('tab', { name: 'People' }),
      screen.getByRole('tab', { name: 'Rules' }),
    ]);
  });

  it('wires each page tab to the id the hub renders its panel under', () => {
    renderNav('people');

    const people = screen.getByRole('tab', { name: 'People' });
    expect(people).toHaveAttribute('id', 'test-tab-records-people');
    expect(people).toHaveAttribute('aria-controls', 'test-panel-records-people');
    expect(people).toHaveAttribute('aria-selected', 'true');
    expect(people).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Inbox' })).toHaveAttribute('tabindex', '-1');
  });

  it('names the open page and what it is for', () => {
    renderNav('rules');

    expect(screen.getByText('What members owe')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for review')).not.toBeInTheDocument();
  });

  it('reports an area choice and a page choice to the hub', async () => {
    const user = userEvent.setup();
    renderNav();

    await user.click(screen.getByRole('tab', { name: 'Setup' }));
    expect(onAreaChange).toHaveBeenCalledWith('settings');
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(onTabChange).toHaveBeenCalledWith('rules');
  });

  // The roving focus moves from the tab the keystroke came from, wrapping at
  // either end, and Home and End jump to the first and last page.
  it.each([
    ['inbox', '{ArrowRight}', 'people'],
    ['rules', '{ArrowRight}', 'inbox'],
    ['inbox', '{ArrowLeft}', 'rules'],
    ['people', '{Home}', 'inbox'],
    ['inbox', '{End}', 'rules'],
  ])('from %s, %s selects %s and moves focus there', async (from, key, to) => {
    const user = userEvent.setup();
    renderNav(from);
    const strip = screen.getByRole('tablist', { name: 'Records pages' });
    const fromTab = within(strip)
      .getAllByRole('tab')
      .find((tab) => tab.id === `test-tab-records-${from}`);
    fromTab?.focus();

    await user.keyboard(key);

    expect(onTabChange).toHaveBeenCalledWith(to);
    expect(document.activeElement?.id).toBe(`test-tab-records-${to}`);
  });

  it('badges a page with its count and its area with the area’s total', () => {
    renderNav('inbox', { inbox: 3, rules: 2, config: 1 });

    const strip = screen.getByRole('tablist', { name: 'Records pages' });
    const inbox = within(strip)
      .getAllByRole('tab')
      .find((tab) => tab.id === 'test-tab-records-inbox');
    expect(inbox).toHaveTextContent('3 need attention');
    expect(screen.getByRole('tab', { name: 'Records' })).toHaveAccessibleDescription(
      'What happened, and approving it. 5 need attention'
    );
    expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAccessibleDescription(
      'How the hub is configured. 1 need attention'
    );
    expect(screen.getByRole('tab', { name: 'People' })).not.toHaveTextContent(/need attention/);
  });
});
