import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AttendanceSection from './AttendanceSection';
import type { EventModuleSettings } from '../../types/event';

const settings = {
  defaults: { attendee_visibility: 'managers' },
  attendance_request_fallback_positions: { training: 'pos-training' },
  mandatory_rsvp_window_days: 60,
} as unknown as EventModuleSettings;

const positions = [
  { id: 'pos-training', name: 'Training Officer', slug: 'training_officer' },
  { id: 'pos-secretary', name: 'Secretary', slug: 'secretary' },
];

const onChangeFallbackPosition = vi.fn();
const onChangeMandatoryRsvpWindow = vi.fn();

const renderSection = (positionOptions: typeof positions | null = positions) =>
  render(
    <AttendanceSection
      settings={settings}
      saving={false}
      onChangeAttendeeVisibility={vi.fn()}
      positionOptions={positionOptions}
      onChangeFallbackPosition={onChangeFallbackPosition}
      onChangeMandatoryRsvpWindow={onChangeMandatoryRsvpWindow}
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

describe('AttendanceSection — mandatory event response window', () => {
  beforeEach(() => {
    onChangeMandatoryRsvpWindow.mockReset();
  });

  it('shows the saved window', () => {
    renderSection();

    expect(screen.getByLabelText('Ask for a response')).toHaveValue(60);
  });

  it('saves once when the field is left, not on every keystroke', async () => {
    const user = userEvent.setup();
    renderSection();

    const input = screen.getByLabelText('Ask for a response');
    await user.clear(input);
    await user.type(input, '90');
    expect(onChangeMandatoryRsvpWindow).not.toHaveBeenCalled();

    await user.tab();
    expect(onChangeMandatoryRsvpWindow).toHaveBeenCalledTimes(1);
    expect(onChangeMandatoryRsvpWindow).toHaveBeenCalledWith(90);
  });

  it('saves on Enter', async () => {
    const user = userEvent.setup();
    renderSection();

    const input = screen.getByLabelText('Ask for a response');
    await user.clear(input);
    await user.type(input, '30{Enter}');

    expect(onChangeMandatoryRsvpWindow).toHaveBeenCalledWith(30);
  });

  it('does not save an unchanged value', () => {
    renderSection();

    fireEvent.blur(screen.getByLabelText('Ask for a response'));

    expect(onChangeMandatoryRsvpWindow).not.toHaveBeenCalled();
  });

  it.each(['0', '366', '2.5'])('refuses %j and says what is allowed', async (value) => {
    const user = userEvent.setup();
    renderSection();

    const input = screen.getByLabelText('Ask for a response');
    await user.clear(input);
    await user.type(input, value);
    await user.tab();

    expect(onChangeMandatoryRsvpWindow).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 365.');
  });

  it('refuses an empty field', async () => {
    const user = userEvent.setup();
    renderSection();

    const input = screen.getByLabelText('Ask for a response');
    await user.clear(input);
    await user.tab();

    expect(onChangeMandatoryRsvpWindow).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 365.');
  });
});
