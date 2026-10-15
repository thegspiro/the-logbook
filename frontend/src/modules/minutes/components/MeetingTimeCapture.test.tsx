import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../components/ux/DateTimeQuarterHour', () => ({
  default: ({ value, onChange, timeLabel }: { value: string; onChange: (v: string) => void; timeLabel?: string }) => (
    <input aria-label={timeLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { MeetingTimeCapture } from './MeetingTimeCapture';
import { localToUTC } from '../../../utils/dateFormatting';

const TZ = 'America/Chicago';
const SCHEDULED = '2026-10-08T00:00:00Z';

describe('MeetingTimeCapture', () => {
  const onSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onSave.mockReset();
    onSave.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const show = (props: Partial<React.ComponentProps<typeof MeetingTimeCapture>> = {}) =>
    render(<MeetingTimeCapture kind="start" timezone={TZ} canEdit onSave={onSave} {...props} />);

  it('records the current minute in one tap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-08T00:02:41Z') });
    show();

    fireEvent.click(screen.getByRole('button', { name: 'Record now' }));

    expect(onSave).toHaveBeenCalledWith('2026-10-08T00:02:00.000Z');
  });

  it('offers the scheduled time as the start, in the department’s zone', async () => {
    const user = userEvent.setup();
    show({ scheduled: SCHEDULED });

    await user.click(screen.getByRole('button', { name: 'Use scheduled time (7:00 PM)' }));

    expect(onSave).toHaveBeenCalledWith(SCHEDULED);
  });

  it('does not offer the scheduled time for the end', () => {
    show({ kind: 'end', scheduled: SCHEDULED });
    expect(screen.queryByRole('button', { name: /Use scheduled time/ })).toBeNull();
  });

  it('shows a recorded time in the department’s zone, with ways to change and clear it', async () => {
    const user = userEvent.setup();
    show({ value: '2026-10-08T00:02:00Z' });

    expect(screen.getByText('Called to order at 7:02 PM')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the called to order time' }));

    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('sets a time by hand', async () => {
    const user = userEvent.setup();
    show({ value: '2026-10-08T00:02:00Z' });

    await user.click(screen.getByRole('button', { name: 'Change the called to order time' }));
    const picker = screen.getByLabelText('Called to order time');
    expect(picker).toHaveValue('2026-10-07T19:02');
    fireEvent.change(picker, { target: { value: '2026-10-07T19:10' } });
    await user.click(screen.getByRole('button', { name: 'Save time' }));

    expect(onSave).toHaveBeenCalledWith(localToUTC('2026-10-07T19:10', TZ));
  });

  it('opens the picker on the scheduled time when none is recorded', async () => {
    const user = userEvent.setup();
    show({ scheduled: SCHEDULED });

    await user.click(screen.getByRole('button', { name: 'Set a time…' }));

    expect(screen.getByLabelText('Called to order time')).toHaveValue('2026-10-07T19:00');
  });

  it('refuses an end at or before the start without asking the server', async () => {
    const user = userEvent.setup();
    show({ kind: 'end', otherTime: '2026-10-08T01:00:00Z' });

    await user.click(screen.getByRole('button', { name: 'Set a time…' }));
    fireEvent.change(screen.getByLabelText('Adjourned time'), { target: { value: '2026-10-07T19:30' } });
    await user.click(screen.getByRole('button', { name: 'Save time' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('adjourned after it was called to order (8:00 PM)');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a start at or after the recorded end', async () => {
    const user = userEvent.setup();
    show({ kind: 'start', otherTime: '2026-10-08T01:00:00Z' });

    await user.click(screen.getByRole('button', { name: 'Set a time…' }));
    fireEvent.change(screen.getByLabelText('Called to order time'), { target: { value: '2026-10-07T21:00' } });
    await user.click(screen.getByRole('button', { name: 'Save time' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('called to order before it adjourned');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the server’s reason and stays open when saving fails', async () => {
    onSave.mockRejectedValue(new Error('The meeting must be adjourned after it is called to order'));
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: 'Record now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('must be adjourned after');
    expect(screen.getByRole('button', { name: 'Record now' })).toBeEnabled();
  });

  it('is read-only without edit rights, and silent when nothing is recorded', () => {
    const { container, rerender } = show({ canEdit: false });
    expect(container).toBeEmptyDOMElement();

    rerender(
      <MeetingTimeCapture kind="start" timezone={TZ} canEdit={false} value="2026-10-08T00:02:00Z" onSave={onSave} />
    );
    expect(screen.getByText('Called to order at 7:02 PM')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
