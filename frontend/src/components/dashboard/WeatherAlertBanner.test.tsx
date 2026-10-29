import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockGetAlerts = vi.fn();

vi.mock('../../services/api', () => ({
  integrationsService: {
    getActiveWeatherAlerts: (...args: unknown[]) => mockGetAlerts(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

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
