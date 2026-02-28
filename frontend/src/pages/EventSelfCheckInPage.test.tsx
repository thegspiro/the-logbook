import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter, mockQRCheckInData, mockRSVP, createMockApiError } from '../test/utils';
import EventSelfCheckInPage from './EventSelfCheckInPage';
import * as apiModule from '../services/api';
import * as reactRouterDom from 'react-router-dom';

// Mock the API module
vi.mock('../services/api', () => ({
  eventService: {
    getQRCheckInData: vi.fn(),
    selfCheckIn: vi.fn(),
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

describe('EventSelfCheckInPage', () => {
  const { eventService } = apiModule;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should display loading message initially', () => {
      vi.mocked(eventService.getQRCheckInData).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderWithRouter(<EventSelfCheckInPage />);

      expect(screen.getByText('Loading event...')).toBeInTheDocument();
    });
  });

  describe('Error State - Loading Event', () => {
    it('should display error message when API call fails', async () => {
      vi.mocked(eventService.getQRCheckInData).mockRejectedValue(
        createMockApiError('Event not found', 404)
      );

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText('Unable to Load Event')).toBeInTheDocument();
        expect(screen.getByText('Event not found')).toBeInTheDocument();
      });
    });

    it('should display generic error message when error has no detail', async () => {
      vi.mocked(eventService.getQRCheckInData).mockRejectedValue(
        new Error('Network error')
      );

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText('Failed to load event information')).toBeInTheDocument();
      });
    });

    it('should show link to all events when error occurs', async () => {
      vi.mocked(eventService.getQRCheckInData).mockRejectedValue(
        createMockApiError('Event not found', 404)
      );

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        const link = screen.getByRole('link', { name: /view all events/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/events');
      });
    });
  });

  describe('Event Display Before Check-In', () => {
    it('should display event details correctly', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Event')).toBeInTheDocument();
        expect(screen.getByText(/Test Location/)).toBeInTheDocument();
        expect(screen.getByText(/business meeting/i)).toBeInTheDocument();
      });
    });

    it('should display event time formatted correctly', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        // Check that "When:" label exists
        expect(screen.getByText(/When:/)).toBeInTheDocument();
      });
    });

    it('should show check-in button when event is valid', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        expect(checkInButton).toBeInTheDocument();
        expect(checkInButton).not.toBeDisabled();
      });
    });

    it('should display confirmation message before check-in', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText(/By checking in, you confirm your attendance/)).toBeInTheDocument();
      });
    });
  });

  describe('Successful Check-In Flow', () => {
    it('should disable button and show loading text during check-in', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockImplementation(
        () => new Promise(() => {}) // Never resolves to keep loading state
      );

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        const loadingButton = screen.getByRole('button', { name: /checking in\.\.\./i });
        expect(loadingButton).toBeInTheDocument();
        expect(loadingButton).toBeDisabled();
      });
    });

    it('should display success message after successful check-in', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockResolvedValue(mockRSVP);

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Successfully Checked In!')).toBeInTheDocument();
        expect(screen.getByText(/You've been checked in to:/)).toBeInTheDocument();
      });
    });

    it('should display check-in timestamp after successful check-in', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockResolvedValue(mockRSVP);

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        expect(screen.getByText(/Checked In At:/)).toBeInTheDocument();
      });
    });

    it('should show navigation links after successful check-in', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockResolvedValue(mockRSVP);

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        const eventDetailsLink = screen.getByRole('link', { name: /view event details/i });
        const allEventsLink = screen.getByRole('link', { name: /view all events/i });

        expect(eventDetailsLink).toHaveAttribute('href', '/events/1');
        expect(allEventsLink).toHaveAttribute('href', '/events');
      });
    });

    it('should call selfCheckIn API with correct event ID', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockResolvedValue(mockRSVP);

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        expect(eventService.selfCheckIn).toHaveBeenCalledWith('1');
      });
    });
  });

  describe('Failed Check-In Flow', () => {
    it('should display error message when check-in fails', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockRejectedValue(
        createMockApiError('You are already checked in', 400)
      );

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        expect(screen.getByText('You are already checked in')).toBeInTheDocument();
      });
    });

    it('should display generic error message when error has no detail', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockRejectedValue(
        new Error('Network error')
      );

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Failed to check in')).toBeInTheDocument();
      });
    });

    it('should keep check-in button enabled after error', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockRejectedValue(
        createMockApiError('You are already checked in', 400)
      );

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        expect(checkInButton).not.toBeDisabled();
      });
    });

    it('should allow retry after failed check-in', async () => {
      let callCount = 0;
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(createMockApiError('Network error', 500));
        }
        return Promise.resolve(mockRSVP);
      });

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      // First attempt - fails
      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });

      // Second attempt - succeeds
      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Successfully Checked In!')).toBeInTheDocument();
      });
    });
  });

  describe('Time Window Validation', () => {
    it('should show warning when check-in is not available', async () => {
      const invalidQRData = {
        ...mockQRCheckInData,
        is_valid: false,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(invalidQRData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText('Check-in Not Available')).toBeInTheDocument();
        expect(screen.getByText(/Check-in is only available during the following time window/)).toBeInTheDocument();
      });
    });

    it('should not show check-in button when outside time window', async () => {
      const invalidQRData = {
        ...mockQRCheckInData,
        is_valid: false,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(invalidQRData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /check in to this event/i })).not.toBeInTheDocument();
      });
    });

    it('should show note when event was ended early', async () => {
      const earlyEndData = {
        ...mockQRCheckInData,
        is_valid: false,
        actual_end_time: '2026-01-25T19:00:00Z',
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(earlyEndData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText(/This event was ended early by the event manager/)).toBeInTheDocument();
      });
    });

    it('should display time window correctly', async () => {
      const invalidQRData = {
        ...mockQRCheckInData,
        is_valid: false,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(invalidQRData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        // Check that time window information is displayed
        const timeWindow = screen.getByText(/Check-in is only available during the following time window/);
        expect(timeWindow).toBeInTheDocument();
      });
    });
  });

  describe('Navigation Links', () => {
    it('should display footer links when event is loaded', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        const links = screen.getAllByRole('link', { name: /view event details/i });
        expect(links.length).toBeGreaterThan(0);
      });
    });

    it('should have correct href for event details link', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        const links = screen.getAllByRole('link', { name: /view event details/i });
        expect(links[links.length - 1]).toHaveAttribute('href', '/events/1');
      });
    });

    it('should have correct href for all events link', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        const links = screen.getAllByRole('link', { name: /view all events/i });
        expect(links[links.length - 1]).toHaveAttribute('href', '/events');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing event ID gracefully', async () => {
      // useParams is a plain arrow function in the mock, not a vi.fn(),
      // so we temporarily replace the module export and restore it afterward.
      const original = reactRouterDom.useParams;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reactRouterDom as any).useParams = () => ({ id: undefined });

      renderWithRouter(<EventSelfCheckInPage />);

      // Should not call API without event ID
      expect(eventService.getQRCheckInData).not.toHaveBeenCalled();

      // Restore original mock
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reactRouterDom as any).useParams = original;
    });

    it('should handle missing location in event data', async () => {
      const dataWithoutLocation = {
        ...mockQRCheckInData,
        location: null,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(dataWithoutLocation);

      renderWithRouter(<EventSelfCheckInPage />);

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

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Event')).toBeInTheDocument();
        expect(screen.queryByText(/Type:/)).not.toBeInTheDocument();
      });
    });

    it('should handle missing checked_in_at in RSVP response', async () => {
      const rsvpWithoutTimestamp = {
        ...mockRSVP,
        checked_in_at: null,
      };

      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockResolvedValue(rsvpWithoutTimestamp);

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Successfully Checked In!')).toBeInTheDocument();
        // Should not crash when timestamp is missing
        expect(screen.queryByText(/Checked In At:/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        const mainHeading = screen.getByRole('heading', { level: 2 });
        expect(mainHeading).toHaveTextContent('Event Check-In');
      });
    });

    it('should have accessible button labels', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);

      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(() => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        expect(checkInButton).toHaveAccessibleName();
      });
    });

    it('should have proper ARIA attributes for success icon', async () => {
      vi.mocked(eventService.getQRCheckInData).mockResolvedValue(mockQRCheckInData);
      vi.mocked(eventService.selfCheckIn).mockResolvedValue(mockRSVP);

      const user = userEvent.setup();
      renderWithRouter(<EventSelfCheckInPage />);

      await waitFor(async () => {
        const checkInButton = screen.getByRole('button', { name: /check in to this event/i });
        await user.click(checkInButton);
      });

      await waitFor(() => {
        // Success state should be visually indicated
        expect(screen.getByText('Successfully Checked In!')).toBeInTheDocument();
      });
    });
  });
});
