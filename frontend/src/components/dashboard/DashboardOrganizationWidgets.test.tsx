import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DashboardPulseResponse, MainDashboardWidgets, PulseCardId } from '../../services/communicationsServices';

const getWidgets = vi.fn();
const getPulseLayout = vi.fn();
const savePulseLayout = vi.fn();
const resetPulseLayout = vi.fn();
const saveDepartmentPulseLayout = vi.fn();
const resetDepartmentPulseLayout = vi.fn();
vi.mock('../../services/api', () => ({
  dashboardService: {
    getWidgets: (...args: unknown[]) => getWidgets(...args) as unknown,
    getPulseLayout: (...args: unknown[]) => getPulseLayout(...args) as unknown,
    savePulseLayout: (...args: unknown[]) => savePulseLayout(...args) as unknown,
    resetPulseLayout: (...args: unknown[]) => resetPulseLayout(...args) as unknown,
    saveDepartmentPulseLayout: (...args: unknown[]) => saveDepartmentPulseLayout(...args) as unknown,
    resetDepartmentPulseLayout: (...args: unknown[]) => resetDepartmentPulseLayout(...args) as unknown,
  },
}));

// Import after the mocks are in place.
import { useAuthStore } from '../../stores/authStore';
import { renderWithRouter } from '../../test/utils';
import DashboardOrganizationWidgets from './DashboardOrganizationWidgets';

const ALL_IDS: PulseCardId[] = [
  'dues',
  'cash_flow',
  'budget_threshold',
  'grant_deadlines',
  'application_stages',
  'campaign_progress',
  'community_engagement',
  'public_requests',
];

const widgets = (overrides: Partial<MainDashboardWidgets> = {}): MainDashboardWidgets => ({
  period: 'month',
  period_label: 'This month',
  finance: null,
  fundraising: null,
  community: { public_events: 3, member_attendees: 4, external_attendees: 6, pending_public_requests: 2 },
  ...overrides,
});

const pulse = (overrides: Partial<DashboardPulseResponse> = {}): DashboardPulseResponse => ({
  layout: { period: null, cards: ALL_IDS.map((id) => ({ id, visible: true, title: null })) },
  personal: false,
  organization_default: false,
  personal_layout: null,
  ...overrides,
});

function signIn(permissions: string[]): void {
  useAuthStore.setState({
    user: {
      id: 'user-1',
      username: 'jdoe',
      email: 'jdoe@example.com',
      organization_id: 'org-1',
      timezone: 'America/New_York',
      roles: [],
      positions: [],
      rank: null,
      membership_type: 'active',
      permissions,
      is_active: true,
      email_verified: true,
      mfa_enabled: false,
      password_expired: false,
      must_change_password: false,
      bottom_nav_slots: null,
    },
  });
}

const cardTitles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('DashboardOrganizationWidgets', () => {
  beforeEach(() => {
    getWidgets.mockReset();
    getPulseLayout.mockReset();
    savePulseLayout.mockReset();
    resetPulseLayout.mockReset();
    saveDepartmentPulseLayout.mockReset();
    resetDepartmentPulseLayout.mockReset();
    getWidgets.mockResolvedValue(widgets());
    getPulseLayout.mockResolvedValue(pulse());
    signIn([]);
  });

  it('shows the cards the member can access in the built-in order', async () => {
    renderWithRouter(<DashboardOrganizationWidgets />);

    await screen.findByText('Community engagement');
    expect(cardTitles()).toEqual(['Community engagement', 'Public requests']);
  });

  it('applies a saved order, hidden card and custom title', async () => {
    getPulseLayout.mockResolvedValue(
      pulse({
        layout: {
          period: null,
          cards: [
            { id: 'public_requests', visible: true, title: 'Outreach asks' },
            { id: 'community_engagement', visible: false, title: null },
            ...ALL_IDS.filter((id) => id !== 'public_requests' && id !== 'community_engagement').map((id) => ({
              id,
              visible: true,
              title: null,
            })),
          ],
        },
        personal: true,
      })
    );
    renderWithRouter(<DashboardOrganizationWidgets />);

    await screen.findByText('Outreach asks');
    expect(cardTitles()).toEqual(['Outreach asks']);
  });

  it('never shows a card the server returned no data for, even when the layout lists it', async () => {
    renderWithRouter(<DashboardOrganizationWidgets />);

    await screen.findByText('Community engagement');
    expect(screen.queryByText('Dues')).not.toBeInTheDocument();
    expect(screen.queryByText('Campaign progress')).not.toBeInTheDocument();
  });

  it('renders nothing at all when the server returned no block', async () => {
    getWidgets.mockResolvedValue(widgets({ community: null }));
    const { container } = renderWithRouter(<DashboardOrganizationWidgets />);

    await waitFor(() => expect(getWidgets).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('opens on the saved period and fetches it first', async () => {
    getPulseLayout.mockResolvedValue(pulse({ layout: { ...pulse().layout, period: 'year' } }));
    renderWithRouter(<DashboardOrganizationWidgets />);

    await screen.findByText('Community engagement');
    expect(getWidgets).toHaveBeenCalledTimes(1);
    expect(getWidgets).toHaveBeenCalledWith('year');
    expect(screen.getByLabelText('Reporting period')).toHaveValue('year');
  });

  it('still shows the cards when the layout cannot be loaded', async () => {
    getPulseLayout.mockRejectedValue(new Error('offline'));
    renderWithRouter(<DashboardOrganizationWidgets />);

    await screen.findByText('Community engagement');
    expect(getWidgets).toHaveBeenCalledWith('month');
  });

  it('saves a changed period with only the member’s own cards', async () => {
    const user = userEvent.setup();
    getPulseLayout.mockResolvedValue(
      pulse({
        layout: { period: null, cards: [{ id: 'public_requests', visible: true, title: null }] },
        personal_layout: { period: null, cards: [{ id: 'public_requests', visible: true, title: null }] },
        personal: true,
      })
    );
    savePulseLayout.mockResolvedValue(pulse());
    renderWithRouter(<DashboardOrganizationWidgets />);
    await screen.findByText('Public requests');

    await user.selectOptions(screen.getByLabelText('Reporting period'), 'quarter');

    expect(savePulseLayout).toHaveBeenCalledWith({
      period: 'quarter',
      cards: [{ id: 'public_requests', visible: true, title: null }],
    });
  });

  it('does not freeze the department order into a personal layout on a period change', async () => {
    const user = userEvent.setup();
    savePulseLayout.mockResolvedValue(pulse());
    renderWithRouter(<DashboardOrganizationWidgets />);
    await screen.findByText('Community engagement');

    await user.selectOptions(screen.getByLabelText('Reporting period'), 'year');

    expect(savePulseLayout).toHaveBeenCalledWith({ period: 'year', cards: [] });
  });

  describe('customizing', () => {
    it('lists only the cards this member can access', async () => {
      const user = userEvent.setup();
      renderWithRouter(<DashboardOrganizationWidgets />);
      await screen.findByText('Community engagement');

      await user.click(screen.getByRole('button', { name: 'Customize' }));

      expect(screen.getByLabelText('Show Community engagement')).toBeChecked();
      expect(screen.getByLabelText('Show Public requests')).toBeChecked();
      expect(screen.queryByLabelText('Show Dues')).not.toBeInTheDocument();
    });

    it('saves a hidden card, a rename and a new order as the member’s own layout', async () => {
      const user = userEvent.setup();
      savePulseLayout.mockResolvedValue(pulse({ personal: true }));
      renderWithRouter(<DashboardOrganizationWidgets />);
      await screen.findByText('Community engagement');
      await user.click(screen.getByRole('button', { name: 'Customize' }));

      await user.click(screen.getByLabelText('Move Public requests up'));
      await user.type(screen.getByLabelText('Title for Public requests'), '  Outreach asks ');
      await user.click(screen.getByLabelText('Show Community engagement'));
      await user.click(screen.getByRole('button', { name: 'Save for me' }));

      await waitFor(() => expect(savePulseLayout).toHaveBeenCalled());
      const sent = savePulseLayout.mock.calls[0]?.[0] as { period: string; cards: Array<Record<string, unknown>> };
      expect(sent.period).toBe('month');
      const visible = sent.cards.filter((c) => ['community_engagement', 'public_requests'].includes(c.id as string));
      expect(visible).toEqual([
        { id: 'public_requests', visible: true, title: 'Outreach asks' },
        { id: 'community_engagement', visible: false, title: null },
      ]);
      expect(sent.cards).toHaveLength(ALL_IDS.length);
    });

    it('offers the department default only to someone holding settings.manage', async () => {
      const user = userEvent.setup();
      renderWithRouter(<DashboardOrganizationWidgets />);
      await screen.findByText('Community engagement');
      await user.click(screen.getByRole('button', { name: 'Customize' }));

      expect(screen.queryByRole('button', { name: 'Save as department default' })).not.toBeInTheDocument();
    });

    it('asks before saving the department default, and saves nothing on Cancel', async () => {
      const user = userEvent.setup();
      signIn(['settings.manage']);
      saveDepartmentPulseLayout.mockResolvedValue(pulse({ organization_default: true }));
      renderWithRouter(<DashboardOrganizationWidgets />);
      await screen.findByText('Community engagement');
      await user.click(screen.getByRole('button', { name: 'Customize' }));

      await user.click(screen.getByRole('button', { name: 'Save as department default' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(saveDepartmentPulseLayout).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Save as department default' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save for everyone' }));
      await waitFor(() => expect(saveDepartmentPulseLayout).toHaveBeenCalled());
      expect((saveDepartmentPulseLayout.mock.calls[0]?.[0] as { period: unknown }).period).toBeNull();
    });

    it('resets a personal layout and offers the reset only when there is one', async () => {
      const user = userEvent.setup();
      getPulseLayout.mockResolvedValue(pulse({ personal: true, organization_default: true }));
      resetPulseLayout.mockResolvedValue(pulse({ organization_default: true }));
      renderWithRouter(<DashboardOrganizationWidgets />);
      await screen.findByText('Community engagement');
      await user.click(screen.getByRole('button', { name: 'Customize' }));

      await user.click(screen.getByRole('button', { name: 'Use department layout' }));

      await waitFor(() => expect(resetPulseLayout).toHaveBeenCalled());
      await waitFor(() => expect(screen.queryByLabelText('Show Public requests')).not.toBeInTheDocument());
    });

    it('says so when every card is hidden', async () => {
      getPulseLayout.mockResolvedValue(
        pulse({
          layout: {
            period: null,
            cards: ALL_IDS.map((id) => ({ id, visible: false, title: null })),
          },
          personal: true,
        })
      );
      renderWithRouter(<DashboardOrganizationWidgets />);

      expect(await screen.findByText(/All cards are hidden/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
    });
  });
});
