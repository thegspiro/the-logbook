import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGetAlerts = vi.fn();

vi.mock('../../services/api', () => ({
  integrationsService: {
    getActiveWeatherAlerts: (...args: unknown[]) => mockGetAlerts(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
const mockIsModuleOn = vi.fn();
let modulesLoading = false;
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: null,
    isLoading: modulesLoading,
    isModuleOn: (...args: unknown[]) => mockIsModuleOn(...args) as boolean,
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
    mockIsModuleOn.mockReset();
    mockIsModuleOn.mockImplementation((key: string) => key === 'integrations');
    modulesLoading = false;
  });

  // The server refuses the read while Integrations is off, so a department
  // that never turned it on drew a 403 every five minutes.
  it('does not ask for alerts while the Integrations module is off', async () => {
    mockIsModuleOn.mockReturnValue(false);
    const { container } = render(<WeatherAlertBanner />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockIsModuleOn).toHaveBeenCalledWith('integrations');
    expect(mockGetAlerts).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('waits for the module list before asking', async () => {
    modulesLoading = true;
    render(<WeatherAlertBanner />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockGetAlerts).not.toHaveBeenCalled();
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
