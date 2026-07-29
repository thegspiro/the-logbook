import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetPackageRecipients = vi.fn();
const mockDownloadPackagePdf = vi.fn();
vi.mock('../../services/api', () => ({
  electionService: {
    getPackageRecipients: (...args: unknown[]) =>
      mockGetPackageRecipients(...args) as unknown,
    downloadPackagePdf: (...args: unknown[]) =>
      mockDownloadPackagePdf(...args) as unknown,
  },
}));

// Import AFTER mocks are in place
import PreMeetingPackageModal from './PreMeetingPackageModal';

describe('PreMeetingPackageModal', () => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();

  const defaultProps = {
    electionId: 'el1',
    electionTitle: 'Annual Officer Election',
    sending: false,
    error: null,
    onSubmit,
    onClose,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPackageRecipients.mockResolvedValue([
      { user_id: 'u1', name: 'Sue Secretary', email: 'sue@dept.org' },
      { user_id: 'u2', name: 'Pat President', email: 'pat@dept.org' },
    ]);
  });

  it('disables send until recipients exist', () => {
    render(<PreMeetingPackageModal {...defaultProps} />);

    expect(
      screen.getByRole('button', { name: /Send to 0 recipients/ })
    ).toBeDisabled();
  });

  it('prefills from leadership and defaults to the full roster variant', async () => {
    const user = userEvent.setup();
    render(<PreMeetingPackageModal {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Leadership' }));

    await waitFor(() => {
      expect(screen.getByText(/sue@dept\.org/)).toBeInTheDocument();
    });
    expect(mockGetPackageRecipients).toHaveBeenCalledWith('el1', 'leadership');
    expect(
      screen.getByRole('checkbox', { name: /full roster detail/i })
    ).toBeChecked();
  });

  it('prefills from eligible voters and defaults to the member variant', async () => {
    const user = userEvent.setup();
    render(<PreMeetingPackageModal {...defaultProps} />);

    await user.click(
      screen.getByRole('button', { name: 'All eligible voters' })
    );

    await waitFor(() => {
      expect(mockGetPackageRecipients).toHaveBeenCalledWith(
        'el1',
        'eligible_voters'
      );
    });
    expect(
      screen.getByRole('checkbox', { name: /full roster detail/i })
    ).not.toBeChecked();
  });

  it('supports removing prefilled recipients and adding free-form addresses', async () => {
    const user = userEvent.setup();
    render(<PreMeetingPackageModal {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Leadership' }));
    await waitFor(() => {
      expect(screen.getByText(/pat@dept\.org/)).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole('button', { name: 'Remove pat@dept.org' })
    );
    expect(screen.queryByText(/pat@dept\.org/)).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Add an email address'),
      'counsel@lawfirm.example'
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await user.click(
      screen.getByRole('button', { name: /Send to 2 recipients/ })
    );

    expect(onSubmit).toHaveBeenCalledWith(
      ['sue@dept.org', 'counsel@lawfirm.example'],
      '',
      true
    );
  });

  it('rejects malformed free-form addresses', async () => {
    const user = userEvent.setup();
    render(<PreMeetingPackageModal {...defaultProps} />);

    await user.type(
      screen.getByLabelText('Add an email address'),
      'not-an-email'
    );
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Send to 0 recipients/ })
    ).toBeDisabled();
  });

  it('shows the send error and closes on cancel', async () => {
    const user = userEvent.setup();
    render(
      <PreMeetingPackageModal {...defaultProps} error="SMTP unavailable" />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('SMTP unavailable');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
