import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { EventForm } from './EventForm';
import * as apiModule from '../services/api';
import type { Location } from '../services/api';
import type { Role } from '../types/role';

// Mock the API module
vi.mock('../services/api', () => ({
  eventService: {
    getVisibleEventTypes: vi.fn(),
  },
  roleService: {
    getRoles: vi.fn(),
  },
  locationsService: {
    getLocations: vi.fn(),
  },
}));

const mockLocations = [
  { id: 'loc-1', name: 'Station 1 Conference Room', is_active: true },
  { id: 'loc-2', name: 'Training Center', is_active: true },
];

const mockRoles = [
  { id: 'role-1', name: 'Firefighter', slug: 'firefighter' },
  { id: 'role-2', name: 'Lieutenant', slug: 'lieutenant' },
  { id: 'role-3', name: 'Captain', slug: 'captain' },
];

describe('EventForm', () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiModule.eventService.getVisibleEventTypes).mockResolvedValue([
      'business_meeting', 'public_education', 'training', 'social', 'fundraiser', 'ceremony', 'other',
    ]);
    vi.mocked(apiModule.locationsService.getLocations).mockResolvedValue(mockLocations as unknown as Location[]);
    vi.mocked(apiModule.roleService.getRoles).mockResolvedValue(mockRoles as unknown as Role[]);
  });

  describe('Rendering', () => {
    it('should render all form sections', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      await waitFor(() => {
        // Section headings are h2 elements
        const headings = screen.getAllByRole('heading', { level: 2 });
        const headingTexts = headings.map(h => h.textContent);
        expect(headingTexts).toContain('Event Details');
        expect(headingTexts).toContain('Schedule');
        expect(headingTexts).toContain('Location');
        expect(headingTexts).toContain('Attendance');
        expect(headingTexts).toContain('RSVP Settings');
        expect(headingTexts).toContain('Check-In Settings');
        expect(headingTexts).toContain('Notifications');
      });
    });

    it('should render submit and cancel buttons', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} submitLabel="Create Event" />
      );

      expect(screen.getByRole('button', { name: /create event/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('should use custom submit label', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} submitLabel="Save Changes" />
      );

      expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    });

    it('should show Saving... when isSubmitting is true', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} isSubmitting={true} />
      );

      expect(screen.getByRole('button', { name: /saving\.\.\./i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /saving\.\.\./i })).toBeDisabled();
    });
  });

  describe('Event Details Section', () => {
    it('should render title input', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const titleInput = screen.getByLabelText(/title/i);
      expect(titleInput).toBeInTheDocument();
      expect(titleInput).toBeRequired();
    });

    it('should render description textarea', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    });

    it('should render event type dropdown with all options', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const typeSelect = screen.getByLabelText(/event type/i);
      expect(typeSelect).toBeInTheDocument();
    });

    it('should show training warning when training type selected', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const user = userEvent.setup();
      const typeSelect = screen.getByLabelText(/event type/i);
      await user.selectOptions(typeSelect, 'training');

      await waitFor(() => {
        expect(screen.getByText(/Create Training Session/)).toBeInTheDocument();
      });
    });
  });

  describe('Schedule Section', () => {
    it('should render start and end datetime inputs', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      expect(screen.getByLabelText(/start date & time/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/end date & time/i)).toBeInTheDocument();
    });

    it('should render quick duration buttons', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      expect(screen.getByRole('button', { name: /1 hour/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /2 hours/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /4 hours/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /8 hours/i })).toBeInTheDocument();
    });
  });

  describe('Location Section', () => {
    it('should load and display locations', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      await waitFor(() => {
        expect(screen.getByText('Station 1 Conference Room')).toBeInTheDocument();
        expect(screen.getByText('Training Center')).toBeInTheDocument();
      });
    });

    it('should toggle between select and manual location modes', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      // The component renders a select dropdown with a "Location" label
      await waitFor(() => {
        expect(screen.getByLabelText(/^Location$/)).toBeInTheDocument();
      });

      // Select the "Other" option to switch to manual text input
      const user = userEvent.setup();
      const locationSelect = screen.getByLabelText(/^Location$/);
      await user.selectOptions(locationSelect, '__other__');

      await waitFor(() => {
        expect(screen.getByLabelText(/location name/i)).toBeInTheDocument();
      });
    });

    it('should fall back to text input when no locations are available', async () => {
      vi.mocked(apiModule.locationsService.getLocations).mockResolvedValue([]);

      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      await waitFor(() => {
        // When no locations are loaded, the fallback text input appears
        expect(screen.getByPlaceholderText(/Station 1 Conference Room/)).toBeInTheDocument();
      });
    });
  });

  describe('RSVP Settings', () => {
    it('should hide RSVP options by default', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      expect(screen.queryByLabelText(/rsvp deadline/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/max attendees/i)).not.toBeInTheDocument();
    });

    it('should show RSVP options when Require RSVP is checked', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const user = userEvent.setup();
      const rsvpCheckbox = screen.getByLabelText(/require rsvp/i);
      await user.click(rsvpCheckbox);

      await waitFor(() => {
        expect(screen.getByLabelText(/rsvp deadline/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/max attendees/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/allow guests/i)).toBeInTheDocument();
      });
    });

    it('should show RSVP status options when RSVP is enabled', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const user = userEvent.setup();
      await user.click(screen.getByLabelText(/require rsvp/i));

      await waitFor(() => {
        expect(screen.getByText('RSVP Status Options')).toBeInTheDocument();
        expect(screen.getByLabelText('Going')).toBeInTheDocument();
        expect(screen.getByLabelText('Not Going')).toBeInTheDocument();
        expect(screen.getByLabelText('Maybe')).toBeInTheDocument();
      });
    });
  });

  describe('Check-In Settings', () => {
    it('should render check-in window dropdown', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const checkinSelect = screen.getByLabelText(/check-in window/i);
      expect(checkinSelect).toBeInTheDocument();
    });

    it('should show window options when Window type is selected', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const user = userEvent.setup();
      const checkinSelect = screen.getByLabelText(/check-in window/i);
      await user.selectOptions(checkinSelect, 'window');

      await waitFor(() => {
        expect(screen.getByLabelText(/minutes before start/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/minutes after start/i)).toBeInTheDocument();
      });
    });

    it('should render require checkout checkbox', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      expect(screen.getByLabelText(/require manual check-out/i)).toBeInTheDocument();
    });
  });

  describe('Notifications Section', () => {
    it('should have send reminders checked by default', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const remindersCheckbox = screen.getByLabelText(/send event reminders/i);
      expect(remindersCheckbox).toBeChecked();
    });

    it('should show reminder schedule when reminders enabled', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      expect(screen.getByText('Reminder Schedule')).toBeInTheDocument();
    });

    it('should hide reminder schedule when reminders disabled', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const user = userEvent.setup();
      await user.click(screen.getByLabelText(/send event reminders/i));

      await waitFor(() => {
        expect(screen.queryByText('Reminder Schedule')).not.toBeInTheDocument();
      });
    });
  });

  describe('Attendance Section', () => {
    it('should render mandatory checkbox', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      expect(screen.getByLabelText(/mandatory attendance/i)).toBeInTheDocument();
    });

  });

  describe('Form Submission', () => {
    it('should call onSubmit with form data', async () => {
      mockOnSubmit.mockResolvedValue(undefined);

      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const user = userEvent.setup();

      // Fill required fields
      await user.type(screen.getByLabelText(/title/i), 'Test Event');

      const startInput = screen.getByLabelText(/start date & time/i);
      await user.clear(startInput);
      await user.type(startInput, '2026-04-01T18:00');

      const endInput = screen.getByLabelText(/end date & time/i);
      await user.clear(endInput);
      await user.type(endInput, '2026-04-01T20:00');

      // Submit form
      const submitButton = screen.getByRole('button', { name: /create event/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Test Event',
          })
        );
      });
    });

    it('should show error when end date is before start date', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/title/i), 'Test Event');

      const startInput = screen.getByLabelText(/start date & time/i);
      await user.clear(startInput);
      await user.type(startInput, '2026-04-01T20:00');

      const endInput = screen.getByLabelText(/end date & time/i);
      await user.clear(endInput);
      await user.type(endInput, '2026-04-01T18:00');

      const submitButton = screen.getByRole('button', { name: /create event/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('End date must be after start date')).toBeInTheDocument();
      });

      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('should call onCancel when cancel button is clicked', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const user = userEvent.setup();
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalled();
    });
  });

  describe('Initial Data', () => {
    it('should pre-fill form with initial data', async () => {
      renderWithRouter(
        <EventForm
          initialData={{
            title: 'Existing Event',
            event_type: 'social',
            is_mandatory: true,
            requires_rsvp: true,
          }}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      await waitFor(() => {
        expect(screen.getByLabelText(/title/i)).toHaveValue('Existing Event');
        expect(screen.getByLabelText(/event type/i)).toHaveValue('social');
        expect(screen.getByLabelText(/mandatory attendance/i)).toBeChecked();
        expect(screen.getByLabelText(/require rsvp/i)).toBeChecked();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper form labels', () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/event type/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/start date & time/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/end date & time/i)).toBeInTheDocument();
    });

    it('should have error role for validation messages', async () => {
      renderWithRouter(
        <EventForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />
      );

      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/title/i), 'Test');

      const startInput = screen.getByLabelText(/start date & time/i);
      await user.clear(startInput);
      await user.type(startInput, '2026-04-01T20:00');

      const endInput = screen.getByLabelText(/end date & time/i);
      await user.clear(endInput);
      await user.type(endInput, '2026-04-01T18:00');

      await user.click(screen.getByRole('button', { name: /create event/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });
});
