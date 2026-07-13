import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MeetingConfig from './MeetingConfig';
import type { MeetingStageConfig, StageConfig } from '../../types';

const baseConfig: MeetingStageConfig = {
  meeting_type: 'chief_meeting',
};

const renderConfig = (
  overrides: Partial<MeetingStageConfig>,
  calcomConnected: boolean,
  integrationsReady = true,
) => {
  const setConfig = vi.fn();
  render(
    <MeetingConfig
      config={{ ...baseConfig, ...overrides } as StageConfig}
      setConfig={setConfig}
      customCategories={[]}
      getNextEventForType={() => undefined}
      renderEventPreview={() => null}
      calcomConnected={calcomConnected}
      integrationsReady={integrationsReady}
    />,
  );
  return { setConfig };
};

describe('MeetingConfig Cal.com scheduling', () => {
  it('hides the scheduling option when Cal.com is not connected', () => {
    renderConfig({}, false);
    expect(screen.queryByLabelText('Scheduling')).not.toBeInTheDocument();
  });

  it('shows a connect hint when Cal.com is not connected', () => {
    renderConfig({}, false, true);
    const hint = screen.getByRole('link', { name: 'Connect Cal.com' });
    expect(hint).toHaveAttribute('href', '/integrations');
  });

  it('shows no hint until the integrations list has loaded', () => {
    renderConfig({}, false, false);
    expect(screen.queryByRole('link', { name: 'Connect Cal.com' })).not.toBeInTheDocument();
  });

  it('shows the scheduling option when Cal.com is connected', () => {
    renderConfig({}, true);
    expect(screen.getByLabelText('Scheduling')).toBeInTheDocument();
    // Booking URL field only appears once the provider is set to Cal.com.
    expect(screen.queryByLabelText('Cal.com Booking Link')).not.toBeInTheDocument();
  });

  it('reveals the booking URL field when the config uses Cal.com', () => {
    renderConfig({ scheduling_provider: 'calcom' }, true);
    expect(screen.getByLabelText('Cal.com Booking Link')).toBeInTheDocument();
  });

  it('records the booking URL the coordinator enters', () => {
    const { setConfig } = renderConfig({ scheduling_provider: 'calcom' }, true);

    fireEvent.change(screen.getByLabelText('Cal.com Booking Link'), {
      target: { value: 'https://cal.com/dept/x' },
    });

    expect(setConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({ calcom_booking_url: 'https://cal.com/dept/x' }),
    );
  });
});
