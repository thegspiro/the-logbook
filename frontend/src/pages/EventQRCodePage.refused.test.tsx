/**
 * The door kiosk refreshes every 30 seconds. When the server refuses the
 * event (cancelled, ended or finalized) the code comes down; a dropped
 * connection leaves it up.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import { renderWithRouter, mockQRCheckInData, createMockApiError } from '../test/utils';
import EventQRCodePage from './EventQRCodePage';
import * as apiModule from '../services/api';

// Mock the API module
vi.mock('../services/api', () => ({
  eventService: {
    getQRCheckInData: vi.fn(),
    getGuestCheckInLink: vi.fn(),
    issueGuestCheckInLink: vi.fn(),
    rotateGuestCheckInLink: vi.fn(),
  },
}));

// Track the useParams return value so we can override it per test
const mockParamsValue: Record<string, string | undefined> = { id: '1' };

// Mock react-router
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => mockParamsValue,
  };
});

// Mock the useTimezone hook
vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

// Mock QRCodeSVG component
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <div data-testid="qr-code" data-value={value}>
      QR Code
    </div>
  ),
}));

describe('EventQRCodePage on the door', () => {
  const { eventService } = apiModule;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('takes the code down once the event is refused', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(eventService.getQRCheckInData)
      .mockResolvedValueOnce(mockQRCheckInData)
      .mockRejectedValue(createMockApiError('Event has been cancelled', 400));
    renderWithRouter(<EventQRCodePage />);
    expect(await screen.findByTestId('qr-code')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(await screen.findByText('Event has been cancelled')).toBeInTheDocument();
    expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument();
  });

  it('keeps the code up through a dropped connection', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(eventService.getQRCheckInData)
      .mockResolvedValueOnce(mockQRCheckInData)
      .mockRejectedValue(new Error('Network Error'));
    renderWithRouter(<EventQRCodePage />);
    expect(await screen.findByTestId('qr-code')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByTestId('qr-code')).toBeInTheDocument();
  });
});
