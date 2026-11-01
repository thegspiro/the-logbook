import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGetAlerts = vi.fn();

vi.mock('../../services/api', () => ({
  integrationsService: {
    getActiveWeatherAlerts: (...args: unknown[]) => mockGetAlerts(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

let mockIntegrationsOn = true;
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: null,
    isModuleOn: (key: string) => key !== 'integrations' || mockIntegrationsOn,
    isLoading: false,
  }),
}));

import WeatherAlertBanner from './WeatherAlertBanner';

const tornado = {
  id: 'w1',
  event: 'Tornado Warning',
  severity: 'Extreme',
  headline: 'Tornado Warning issued for Falls Church',
  instruction: 'Take shelter now.',
  area_desc: 'Falls Church, VA',
  onset: null,
  expires: '2026-10-29T22:00:00Z',
};

describe('WeatherAlertBanner', () => {
  beforeEach(() => {
    mockGetAlerts.mockReset();
    mockIntegrationsOn = true;
  });

  // Workflow review W01, 2026-10-31: the alerts live behind the Integrations
  // module, and a fresh install that left it off saw the dashboard refused
  // (403) on every load.
  it('does not ask for alerts when the Integrations module is off', async () => {
    mockIntegrationsOn = false;
    mockGetAlerts.mockResolvedValue([tornado]);
    const { container } = render(<WeatherAlertBanner />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGetAlerts).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows each active alert with what to do', async () => {
    mockGetAlerts.mockResolvedValue([tornado]);
    render(<WeatherAlertBanner />);

    expect(await screen.findByRole('region', { name: 'Severe weather alerts' })).toBeInTheDocument();
    expect(screen.getByText('Tornado Warning issued for Falls Church')).toBeInTheDocument();
    expect(screen.getByText('Take shelter now.')).toBeInTheDocument();
    expect(screen.getByText(/^Until /)).toBeInTheDocument();
  });

  it('draws nothing when there is no alert, or the read fails', async () => {
    mockGetAlerts.mockResolvedValue([]);
    const { container, unmount } = render(<WeatherAlertBanner />);
    await vi.waitFor(() => expect(mockGetAlerts).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    unmount();

    mockGetAlerts.mockRejectedValue(new Error('down'));
    const view = render(<WeatherAlertBanner />);
    await vi.waitFor(() => expect(mockGetAlerts).toHaveBeenCalledTimes(2));
    expect(view.container).toBeEmptyDOMElement();
  });
});
