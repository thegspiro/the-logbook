import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AttendanceSection from './AttendanceSection';
import type { EventModuleSettings } from '../../types/event';

const settings = {
  defaults: { attendee_visibility: 'managers' },
  attendance_request_fallback_positions: { training: 'pos-training' },
} as unknown as EventModuleSettings;

const positions = [
  { id: 'pos-training', name: 'Training Officer', slug: 'training_officer' },
  { id: 'pos-secretary', name: 'Secretary', slug: 'secretary' },
];

const onChangeFallbackPosition = vi.fn();

const renderSection = (positionOptions: typeof positions | null = positions) =>
  render(
    <AttendanceSection
      settings={settings}
      saving={false}
      onChangeAttendeeVisibility={vi.fn()}
      positionOptions={positionOptions}
      onChangeFallbackPosition={onChangeFallbackPosition}
    />
  );

describe('AttendanceSection — attendance request fallback', () => {
  beforeEach(() => {
    onChangeFallbackPosition.mockReset();
  });

  it('shows the configured position per event type and the default otherwise', () => {
    renderSection();

    expect(screen.getByLabelText('Training')).toHaveValue('pos-training');
    expect(screen.getByLabelText('Business Meeting')).toHaveValue('');
  });

  it('saves a pick, and null when returned to the default', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.selectOptions(screen.getByLabelText('Business Meeting'), 'pos-secretary');
    await user.selectOptions(screen.getByLabelText('Training'), '');

    expect(onChangeFallbackPosition).toHaveBeenNthCalledWith(1, 'business_meeting', 'pos-secretary');
    expect(onChangeFallbackPosition).toHaveBeenNthCalledWith(2, 'training', null);
  });

  it('says so when the positions could not be loaded rather than offering only the default', () => {
    renderSection(null);

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByLabelText('Training')).not.toBeInTheDocument();
  });
});
