import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { useAuthStore } from '../../stores/authStore';
import { GuestCheckInQRCard } from './GuestCheckInQRCard';

const getGuestCheckInLink = vi.fn();
const issueGuestCheckInLink = vi.fn();
const rotateGuestCheckInLink = vi.fn();

vi.mock('../../services/api', () => ({
  eventService: {
    getGuestCheckInLink: (...args: unknown[]) => getGuestCheckInLink(...args) as unknown,
    issueGuestCheckInLink: (...args: unknown[]) => issueGuestCheckInLink(...args) as unknown,
    rotateGuestCheckInLink: (...args: unknown[]) => rotateGuestCheckInLink(...args) as unknown,
  },
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="qr-code" data-value={value} />,
}));

const TOKEN = 'a'.repeat(43);
const NEW_TOKEN = 'b'.repeat(43);

const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const link = (guest_token: string | null, overrides: Record<string, unknown> = {}) => ({
  event_id: 'evt-1',
  allow_guest_check_in: true,
  guest_token,
  is_open: true,
  closed_reason: null,
  check_in_opens_at: iso(-HOUR),
  check_in_closes_at: iso(HOUR),
  ...overrides,
});

const notYetOpen = (guest_token: string | null) =>
  link(guest_token, {
    is_open: false,
    closed_reason: 'Check-in for this event has not opened yet.',
    check_in_opens_at: iso(2 * HOUR),
    check_in_closes_at: iso(4 * HOUR),
  });

const renderCard = (props: Partial<React.ComponentProps<typeof GuestCheckInQRCard>> = {}) =>
  renderWithRouter(<GuestCheckInQRCard eventId="evt-1" eventName="Open House" allowGuestCheckIn {...props} />);

describe('GuestCheckInQRCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGuestCheckInLink.mockReset();
    issueGuestCheckInLink.mockReset();
    rotateGuestCheckInLink.mockReset();
    getGuestCheckInLink.mockResolvedValue(link(TOKEN));
    issueGuestCheckInLink.mockResolvedValue(link(TOKEN));
    rotateGuestCheckInLink.mockResolvedValue(link(NEW_TOKEN));
    useAuthStore.setState({ user: { permissions: ['events.manage'] } as never });
  });

  it('shows a member without events.manage nothing, and never asks for the token', () => {
    useAuthStore.setState({ user: { permissions: ['events.view'] } as never });
    const { container } = renderCard({ showOffHint: true });

    expect(container).toBeEmptyDOMElement();
    expect(getGuestCheckInLink).not.toHaveBeenCalled();
  });

  it('shows the existing code without issuing a new one', async () => {
    renderCard();

    const qr = await screen.findByTestId('qr-code');
    expect(qr).toHaveAttribute('data-value', `${window.location.origin}/event-guest/${TOKEN}`);
    expect(getGuestCheckInLink).toHaveBeenCalledWith('evt-1');
    expect(issueGuestCheckInLink).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Guest check-in link')).toHaveValue(`${window.location.origin}/event-guest/${TOKEN}`);
  });

  it('issues a code on first view when the event has none', async () => {
    getGuestCheckInLink.mockResolvedValue(link(null));

    renderCard();

    const qr = await screen.findByTestId('qr-code');
    expect(issueGuestCheckInLink).toHaveBeenCalledWith('evt-1');
    expect(qr).toHaveAttribute('data-value', `${window.location.origin}/event-guest/${TOKEN}`);
  });

  it('explains how to turn guest check-in on when asked to, without loading a code', () => {
    renderCard({ allowGuestCheckIn: false, showOffHint: true });

    expect(screen.getByText(/Guest check-in is off for this event/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'edit the event' })).toHaveAttribute('href', '/events/evt-1/edit');
    expect(getGuestCheckInLink).not.toHaveBeenCalled();
  });

  it('renders nothing while guest check-in is off unless asked to explain', () => {
    const { container } = renderCard({ allowGuestCheckIn: false });

    expect(container).toBeEmptyDOMElement();
    expect(getGuestCheckInLink).not.toHaveBeenCalled();
  });

  it('resets the code after the manager confirms', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByTestId('qr-code');

    await user.click(screen.getByRole('button', { name: /Reset code/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reset code' }));

    await waitFor(() =>
      expect(screen.getByTestId('qr-code')).toHaveAttribute(
        'data-value',
        `${window.location.origin}/event-guest/${NEW_TOKEN}`
      )
    );
    expect(rotateGuestCheckInLink).toHaveBeenCalledWith('evt-1');
  });

  it('keeps the code when the manager backs out of the reset', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByTestId('qr-code');

    await user.click(screen.getByRole('button', { name: /Reset code/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep current code' }));

    expect(rotateGuestCheckInLink).not.toHaveBeenCalled();
    expect(screen.getByTestId('qr-code')).toHaveAttribute(
      'data-value',
      `${window.location.origin}/event-guest/${TOKEN}`
    );
  });

  it('says so when the code cannot be loaded', async () => {
    getGuestCheckInLink.mockRejectedValue(new Error('Network down'));

    renderCard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
  });

  it('warns that a draft event refuses guests until it is published', async () => {
    renderCard({ isDraft: true });

    expect(await screen.findByText(/not published yet/)).toBeInTheDocument();
  });

  it('offers Print and the full-size page only where the caller asks', async () => {
    const onPrint = vi.fn();
    const user = userEvent.setup();
    renderCard({ onPrint, showFullPageLink: true });
    await screen.findByTestId('qr-code');

    await user.click(screen.getByRole('button', { name: /Print Guest QR Code/ }));
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Show full size' })).toHaveAttribute('href', '/events/evt-1/qr-code');
  });

  it('offers neither by default', async () => {
    renderCard();
    await screen.findByTestId('qr-code');

    expect(screen.queryByRole('button', { name: /Print Guest QR Code/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Show full size' })).not.toBeInTheDocument();
  });

  describe('before and after the check-in window', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('withholds the code, the link and Print until check-in opens', async () => {
      getGuestCheckInLink.mockResolvedValue(notYetOpen(TOKEN));
      renderCard({ onPrint: vi.fn() });

      expect(await screen.findByTestId('guest-qr-placeholder')).toHaveTextContent(
        'QR code hidden until check-in opens'
      );
      expect(screen.getByText('Check-in for this event has not opened yet.')).toBeInTheDocument();
      expect(screen.getByText(/The code appears here when check-in opens/)).toBeInTheDocument();
      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Guest check-in link')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Print Guest QR Code/ })).not.toBeInTheDocument();
    });

    it('still lets a manager reset a code that leaked before the event', async () => {
      getGuestCheckInLink.mockResolvedValue(notYetOpen(TOKEN));
      rotateGuestCheckInLink.mockResolvedValue(notYetOpen(NEW_TOKEN));
      const user = userEvent.setup();
      renderCard();
      await screen.findByTestId('guest-qr-placeholder');

      await user.click(screen.getByRole('button', { name: /Reset code/ }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset code' }));

      await waitFor(() => expect(rotateGuestCheckInLink).toHaveBeenCalledWith('evt-1'));
      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
    });

    it('says check-in is closed, not that the code is coming, once it has ended', async () => {
      getGuestCheckInLink.mockResolvedValue(
        link(TOKEN, {
          is_open: false,
          closed_reason: 'Check-in has closed for this event.',
          check_in_opens_at: iso(-4 * HOUR),
          check_in_closes_at: iso(-2 * HOUR),
        })
      );
      renderCard();

      expect(await screen.findByTestId('guest-qr-placeholder')).toHaveTextContent('check-in is closed');
      expect(screen.queryByText(/The code appears here/)).not.toBeInTheDocument();
      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
    });

    it('hides the code while attendance is finalized, inside the window', async () => {
      getGuestCheckInLink.mockResolvedValue(
        link(TOKEN, { is_open: false, closed_reason: 'Attendance for this event has been closed.' })
      );
      renderCard();

      expect(await screen.findByText('Attendance for this event has been closed.')).toBeInTheDocument();
      expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
    });

    it('shows the code without a reload once the window opens', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      getGuestCheckInLink.mockResolvedValueOnce(notYetOpen(TOKEN)).mockResolvedValue(link(TOKEN));
      renderCard();
      await screen.findByTestId('guest-qr-placeholder');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });

      expect(await screen.findByTestId('qr-code')).toHaveAttribute(
        'data-value',
        `${window.location.origin}/event-guest/${TOKEN}`
      );
      expect(screen.queryByTestId('guest-qr-placeholder')).not.toBeInTheDocument();
    });
  });
});
