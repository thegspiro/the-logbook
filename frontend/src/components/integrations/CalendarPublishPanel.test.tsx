import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { CalendarPublishPanel } from './CalendarPublishPanel';
import type { CalendarProvider } from './calendarProviders';
import type { IntegrationConfig } from '../../services/api';

const mockUpdateIntegration = vi.fn();
const mockDisconnectIntegration = vi.fn();
vi.mock('../../services/api', () => ({
  integrationsService: {
    updateIntegration: (...args: unknown[]) => mockUpdateIntegration(...args) as unknown,
    disconnectIntegration: (...args: unknown[]) => mockDisconnectIntegration(...args) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args) as unknown,
    error: (...args: unknown[]) => toastError(...args) as unknown,
  },
}));

const provider: CalendarProvider = {
  integrationType: 'google-calendar',
  name: 'Google Calendar',
  signInWith: 'Google',
  queryKey: 'google_calendar',
  intro: 'Sign in with Google.',
  disconnectMessage: 'Events stop being published.',
  start: () => Promise.resolve('https://accounts.google.com/'),
  errors: {},
};

const integration = (config: Record<string, unknown> = {}, status: IntegrationConfig['status'] = 'connected') =>
  ({
    id: 'gcal-1',
    organization_id: 'org-1',
    integration_type: 'google-calendar',
    name: 'Google Calendar',
    status,
    enabled: status === 'connected',
    config: { account_email: 'calendar@dept.org', calendar_name: 'Station Events', ...config },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) satisfies IntegrationConfig;

const renderPanel = (config: Record<string, unknown> = {}, status: IntegrationConfig['status'] = 'connected') => {
  const onUpdated = vi.fn();
  renderWithRouter(
    <CalendarPublishPanel
      provider={provider}
      integration={integration(config, status)}
      onUpdated={onUpdated}
      onDisconnected={vi.fn()}
    />
  );
  return { onUpdated };
};

describe('CalendarPublishPanel — what is published', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateIntegration.mockReset();
    mockUpdateIntegration.mockImplementation((_id: string, config: Record<string, unknown>) =>
      Promise.resolve(integration(config))
    );
  });

  it('shows the defaults the pass uses when nothing is saved: 180 days, every type', () => {
    renderPanel();
    const scope = screen.getByTestId('google-calendar-publish-scope');
    expect(within(scope).getByLabelText('Days ahead')).toHaveValue(180);
    for (const box of within(scope).getAllByRole('checkbox')) {
      expect(box).not.toBeChecked();
    }
    expect(within(scope).getByText(/Leave all unticked to publish every type/)).toBeInTheDocument();
  });

  it('shows the saved range and types', () => {
    renderPanel({ days_ahead: 90, event_types_to_sync: ['training'] });
    const scope = screen.getByTestId('google-calendar-publish-scope');
    expect(within(scope).getByLabelText('Days ahead')).toHaveValue(90);
    expect(within(scope).getByRole('checkbox', { name: 'Training' })).toBeChecked();
    expect(within(scope).getByRole('checkbox', { name: 'Social' })).not.toBeChecked();
  });

  it('saves the range and the ticked types in one settings update', async () => {
    const user = userEvent.setup();
    const { onUpdated } = renderPanel();
    const scope = screen.getByTestId('google-calendar-publish-scope');
    const days = within(scope).getByLabelText('Days ahead');
    await user.clear(days);
    await user.type(days, '365');
    await user.click(within(scope).getByRole('checkbox', { name: 'Training' }));
    await user.click(within(scope).getByRole('checkbox', { name: 'Fundraiser' }));
    await user.click(within(scope).getByRole('button', { name: 'Save publishing settings' }));

    await waitFor(() => {
      expect(mockUpdateIntegration).toHaveBeenCalledWith('gcal-1', {
        days_ahead: 365,
        event_types_to_sync: ['training', 'fundraiser'],
      });
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Publishing settings saved');
  });

  // '{Backspace}' leaves the box empty, which is not a range either.
  it.each(['0', '731', '12.5', '{Backspace}'])('refuses %j days without sending anything', async (value) => {
    const user = userEvent.setup();
    renderPanel();
    const scope = screen.getByTestId('google-calendar-publish-scope');
    const days = within(scope).getByLabelText('Days ahead');
    await user.clear(days);
    await user.type(days, value);

    expect(within(scope).getByRole('alert')).toHaveTextContent('from 1 to 730');
    const save = within(scope).getByRole('button', { name: 'Save publishing settings' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(mockUpdateIntegration).not.toHaveBeenCalled();
  });

  it('says when a saved filter names a type no event can have', () => {
    renderPanel({ event_types_to_sync: ['training', 'drill_night'] });
    const scope = screen.getByTestId('google-calendar-publish-scope');
    expect(within(scope).getByRole('status')).toHaveTextContent('drill_night');
    expect(within(scope).getByRole('checkbox', { name: 'Training' })).toBeChecked();
  });

  it('reports a refused save', async () => {
    const user = userEvent.setup();
    mockUpdateIntegration.mockRejectedValue(new Error('Unknown event type(s): x'));
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Save publishing settings' }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
  });

  it('is not offered until the calendar is connected', () => {
    renderPanel({}, 'available');
    expect(screen.queryByTestId('google-calendar-publish-scope')).not.toBeInTheDocument();
  });
});
