import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter, mockQRCheckInData, createMockApiError } from '../test/utils';
import EventQRCodePage from './EventQRCodePage';
import type { QRCheckInData } from '../types/event';
import * as apiModule from '../services/api';
import * as reactRouterDom from 'react-router-dom';

// Mock the API module
vi.mock('../services/api', () => ({
  eventService: {
    getQRCheckInData: vi.fn(),
  },
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '1' }),
  };
});

// Mock QRCodeSVG component
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <div data-testid="qr-code" data-value={value}>
      QR Code
    </div>
  ),
}));

describe('EventQRCodePage', () => {
  const { eventService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Loading State', () => {
    it('should display loading message initially', () => {
      vi.mocked(eventService.getQRCheckInData).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderWithRouter(<EventQRCodePage />);

      expect(screen.getByText('Loading QR code...')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error message when API call fails', async () => {
      vi.mocked(eventService.getQRCheckInData).mockRejectedValue(
        createMockApiError('Event not found', 404)
      );

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.getByText('Event not found')).toBeInTheDocument();
      });
    });

    it('should display generic error message when error has no detail', async () => {
      vi.mocked(eventService.getQRCheckInData).mockRejectedValue(
        new Error('Network error')
      );

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        // getErrorMessage extracts the Error message, so "Network error" is shown
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should show back link when error occurs', async () => {
      vi.mocked(eventService.getQRCheckInData).mockRejectedValue(
        createMockApiError('Event not found', 404)
      );

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        const backLink = screen.getByRole('link', { name: /back to event/i });
        expect(backLink).toBeInTheDocument();
        expect(backLink).toHaveAttribute('href', '/events/1');
      });
    });
  });

  describe('Valid QR Code Display', () => {
    it('should display QR code when check-in is valid', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Event')).toBeInTheDocument();
        expect(screen.getByTestId('qr-code')).toBeInTheDocument();
        expect(screen.getByText('Check-in is Active')).toBeInTheDocument();
      });
    });

    it('should display event details correctly', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Event')).toBeInTheDocument();
        expect(screen.getByText(/Test Location/)).toBeInTheDocument();
        // event_type is displayed with .replace('_', ' ') → "business meeting"
        expect(screen.getByText(/business meeting/i)).toBeInTheDocument();
      });
    });

    it('should generate correct check-in URL for QR code', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        const qrCode = screen.getByTestId('qr-code');
        expect(qrCode.getAttribute('data-value')).toBe(
          `${window.location.origin}/events/1/check-in`
        );
      });
    });

    it('should display instructions for scanning QR code', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.getByText(/Display this QR code at the event venue/)).toBeInTheDocument();
        expect(screen.getByText(/Members scan the code with their phone camera/)).toBeInTheDocument();
      });
    });

    it('should show print button when QR code is valid', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        const printButton = screen.getByRole('button', { name: /print qr code/i });
        expect(printButton).toBeInTheDocument();
      });
    });

    it('should call window.print when print button is clicked', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      const user = userEvent.setup({ delay: null });

      renderWithRouter(<EventQRCodePage />);

      await waitFor(async () => {
        const printButton = screen.getByRole('button', { name: /print qr code/i });
        await user.click(printButton);
      });

      expect(window.print).toHaveBeenCalled();
    });
  });

  describe('Invalid QR Code (Outside Time Window)', () => {
    it('should display warning when check-in is not available', async () => {
      const invalidQRData = {
        ...mockQRCheckInData,
        is_valid: false,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(invalidQRData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.getByText('Check-in Not Available')).toBeInTheDocument();
        expect(screen.getByText(/Check-in is only available during the following time window/)).toBeInTheDocument();
      });
    });

    it('should show greyed-out QR code when check-in is invalid', async () => {
      const invalidQRData = {
        ...mockQRCheckInData,
        is_valid: false,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(invalidQRData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        // QR code is still rendered (greyed out via opacity) so it's ready when the window opens
        expect(screen.getByTestId('qr-code')).toBeInTheDocument();
      });
    });

    it('should not show print button when check-in is invalid', async () => {
      const invalidQRData = {
        ...mockQRCheckInData,
        is_valid: false,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(invalidQRData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /print qr code/i })).not.toBeInTheDocument();
      });
    });

    it('should show note when event was ended early', async () => {
      const earlyEndData = {
        ...mockQRCheckInData,
        is_valid: false,
        actual_end_time: '2026-01-25T19:00:00Z',
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(earlyEndData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.getByText(/Event was ended early by event manager/)).toBeInTheDocument();
      });
    });
  });

  describe('Auto-refresh Functionality', () => {
    it('should refresh QR data every 30 seconds', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      // Initial load
      await waitFor(() => {
        expect(eventService.getQRCheckInData).toHaveBeenCalledTimes(1);
      });

      // Fast-forward 30 seconds
      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        expect(eventService.getQRCheckInData).toHaveBeenCalledTimes(2);
      });

      // Fast-forward another 30 seconds
      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        expect(eventService.getQRCheckInData).toHaveBeenCalledTimes(3);
      });
    });

    it('should update validity status when QR data changes', async () => {
      let callCount = 0;
      vi.mocked(eventService.getQRCheckInData).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ...mockQRCheckInData,
          is_valid: callCount === 1, // Valid on first call, invalid after
        });
      });

      renderWithRouter(<EventQRCodePage />);

      // Initially valid
      await waitFor(() => {
        expect(screen.getByText('Check-in is Active')).toBeInTheDocument();
      });

      // After 30 seconds, should be invalid
      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        expect(screen.getByText('Check-in Not Available')).toBeInTheDocument();
      });
    });

    it('should handle errors during auto-refresh gracefully', async () => {
      let callCount = 0;
      vi.mocked(eventService.getQRCheckInData).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(mockQRCheckInData);
        }
        return Promise.reject(createMockApiError('Network error'));
      });

      renderWithRouter(<EventQRCodePage />);

      // Initially successful
      await waitFor(() => {
        expect(screen.getByText('Test Event')).toBeInTheDocument();
      });

      // After 30 seconds, a refresh occurs and fails silently.
      // The component keeps showing existing data without crashing.
      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        // Event data should still be visible (error swallowed on refresh when data exists)
        expect(screen.getByText('Test Event')).toBeInTheDocument();
        // The API was called twice (initial + refresh)
        expect(eventService.getQRCheckInData).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Navigation', () => {
    it('should display back to event link', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        const backLink = screen.getByRole('link', { name: /back to event/i });
        expect(backLink).toBeInTheDocument();
        expect(backLink).toHaveAttribute('href', '/events/1');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing event ID gracefully', async () => {
      // useParams is a plain arrow function in the mock, not a vi.fn(),
      // so we temporarily replace the module export.
      const original = reactRouterDom.useParams;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reactRouterDom as any).useParams = () => ({ id: undefined });

      renderWithRouter(<EventQRCodePage />);

      // Should not call API without event ID
      expect(eventService.getQRCheckInData).not.toHaveBeenCalled();

      // Restore original mock
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reactRouterDom as any).useParams = original;
    });

    it('should handle null QR data', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(null as unknown as QRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.getByText('No QR code data available')).toBeInTheDocument();
      });
    });

    it('should handle missing location in event data', async () => {
      const dataWithoutLocation = {
        ...mockQRCheckInData,
        location: null,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(dataWithoutLocation);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Event')).toBeInTheDocument();
        expect(screen.queryByText(/Location:/)).not.toBeInTheDocument();
      });
    });

    it('should handle missing event type in event data', async () => {
      const dataWithoutType = {
        ...mockQRCheckInData,
        event_type: null,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(dataWithoutType);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        expect(screen.getByText('Test Event')).toBeInTheDocument();
        expect(screen.queryByText(/Type:/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        const mainHeading = screen.getByRole('heading', { level: 1 });
        expect(mainHeading).toHaveTextContent('Event Check-In QR Code');
      });
    });

    it('should have accessible button labels', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventQRCodePage />);

      await waitFor(() => {
        const printButton = screen.getByRole('button', { name: /print qr code/i });
        expect(printButton).toHaveAccessibleName();
      });
    });
  });
});
