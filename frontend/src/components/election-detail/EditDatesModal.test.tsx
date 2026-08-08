import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditDatesModal from './EditDatesModal';

describe('EditDatesModal', () => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();

  const defaultProps = {
    currentStartDate: '2026-08-01T19:00:00Z',
    currentEndDate: '2026-08-02T19:00:00Z',
    error: null,
    onSubmit,
    onClose,
    timezone: 'America/New_York',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the current voting window and pre-fills both inputs', () => {
    render(<EditDatesModal {...defaultProps} />);

    expect(screen.getByText('Edit Voting Window')).toBeInTheDocument();
    expect(screen.getByLabelText('Voting Opens')).not.toHaveValue('');
    expect(screen.getByLabelText('Voting Closes')).not.toHaveValue('');
  });

  it('submits the selected window', async () => {
    const user = userEvent.setup();
    render(<EditDatesModal {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Start Now' }));
    await user.click(screen.getByRole('button', { name: '15 Min' }));
    await user.click(screen.getByRole('button', { name: 'Save Window' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.any(String) as string, expect.any(String) as string);
    const [start, end] = onSubmit.mock.calls[0] as [string, string];
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(15 * 60 * 1000);
  });

  it('renders the error and closes on cancel', async () => {
    const user = userEvent.setup();
    render(<EditDatesModal {...defaultProps} error="End date must be after start date" />);

    expect(screen.getByRole('alert')).toHaveTextContent('End date must be after start date');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
