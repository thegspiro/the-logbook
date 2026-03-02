import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormsListResponse } from '@/services/inventoryService';

const mockGetForms = vi.fn();
const mockGetEvents = vi.fn();

vi.mock('@/services/formsServices', () => ({
  formsService: {
    getForms: (...args: unknown[]) => mockGetForms(...args) as unknown,
  },
}));

vi.mock('@/services/eventServices', () => ({
  eventService: {
    getEvents: (...args: unknown[]) => mockGetEvents(...args) as unknown,
  },
}));

vi.mock('@/utils/eventHelpers', () => ({
  getEventTypeLabel: (type: string) => {
    const labels: Record<string, string> = {
      business_meeting: 'Business Meeting',
      training: 'Training',
      public_education: 'Public Education',
    };
    return labels[type] ?? type;
  },
}));

vi.mock('@/utils/dateFormatting', () => ({
  formatDateTime: (d: string) => new Date(d).toLocaleString(),
}));

import { StageConfigModal } from './StageConfigModal';

const mockForms: FormsListResponse = {
  forms: [
    {
      id: 'form-1',
      organization_id: 'org-1',
      name: 'New Member Application',
      description: 'Application for new members',
      category: 'membership',
      status: 'published',
      allow_multiple_submissions: false,
      require_authentication: true,
      notify_on_submission: true,
      is_public: true,
      public_slug: 'new-member-app',
      version: 1,
      is_template: false,
      field_count: 10,
      submission_count: 5,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-15T00:00:00Z',
    },
    {
      id: 'form-2',
      organization_id: 'org-1',
      name: 'Background Check Authorization',
      category: '',
      status: 'published',
      allow_multiple_submissions: false,
      require_authentication: true,
      notify_on_submission: false,
      is_public: false,
      version: 1,
      is_template: false,
      field_count: 5,
      submission_count: 3,
      created_at: '2026-01-05T00:00:00Z',
      updated_at: '2026-01-10T00:00:00Z',
    },
  ],
  total: 2,
  skip: 0,
  limit: 200,
};

const mockUpcomingEvents = [
  {
    id: 'evt-1',
    title: 'March Business Meeting',
    event_type: 'business_meeting',
    start_datetime: '2026-03-15T19:00:00Z',
    end_datetime: '2026-03-15T21:00:00Z',
    location_name: 'Station 1',
    requires_rsvp: false,
    is_mandatory: false,
    is_cancelled: false,
  },
  {
    id: 'evt-2',
    title: 'Spring Training Session',
    event_type: 'training',
    start_datetime: '2026-03-20T09:00:00Z',
    end_datetime: '2026-03-20T12:00:00Z',
    location_name: 'Training Center',
    requires_rsvp: true,
    is_mandatory: true,
    is_cancelled: false,
  },
];

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
  existingStageCount: 0,
};

describe('StageConfigModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetForms.mockResolvedValue(mockForms);
    mockGetEvents.mockResolvedValue(mockUpcomingEvents);
  });

  it('renders the modal when open', () => {
    render(<StageConfigModal {...defaultProps} />);
    expect(screen.getByText('Add Pipeline Stage')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<StageConfigModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText('Add Pipeline Stage')).not.toBeInTheDocument();
  });

  // =========================================================================
  // Form Dropdown Tests
  // =========================================================================

  it('fetches published forms when modal opens', async () => {
    render(<StageConfigModal {...defaultProps} />);
    await waitFor(() => {
      expect(mockGetForms).toHaveBeenCalledWith({ status: 'published', limit: 200 });
    });
  });

  it('shows form dropdown with published forms when form_submission type is selected', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Form Submission'));

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    expect(screen.getByText('New Member Application (membership)')).toBeInTheDocument();
    expect(screen.getByText('Background Check Authorization')).toBeInTheDocument();
  });

  it('sets form_id and form_name when a form is selected from dropdown', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Form Submission'));

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/stage name/i), 'Application Step');
    await user.selectOptions(screen.getByRole('combobox'), 'form-1');
    await user.click(screen.getByText('Add Stage'));

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        stage_type: 'form_submission',
        config: expect.objectContaining({
          form_id: 'form-1',
          form_name: 'New Member Application',
        }) as unknown,
      })
    );
  });

  it('shows error state when forms fail to load', async () => {
    mockGetForms.mockRejectedValue(new Error('Network error'));
    render(<StageConfigModal {...defaultProps} />);

    await userEvent.click(screen.getByText('Form Submission'));

    await waitFor(() => {
      expect(screen.getByText('Failed to load forms')).toBeInTheDocument();
    });
  });

  it('allows retrying after a form fetch failure', async () => {
    const user = userEvent.setup();
    mockGetForms.mockRejectedValueOnce(new Error('Network error'));
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Form Submission'));

    await waitFor(() => {
      expect(screen.getByText('Failed to load forms')).toBeInTheDocument();
    });

    mockGetForms.mockResolvedValueOnce(mockForms);
    await user.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
  });

  it('shows helpful message when no published forms exist', async () => {
    mockGetForms.mockResolvedValue({ forms: [], total: 0, skip: 0, limit: 200 });
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Form Submission'));

    await waitFor(() => {
      expect(screen.getByText(/no published forms found/i)).toBeInTheDocument();
    });
  });

  it('validates that a form is selected before saving', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Form Submission'));
    await user.type(screen.getByLabelText(/stage name/i), 'Application Step');

    await user.click(screen.getByText('Add Stage'));

    expect(screen.getByText('Please select a form')).toBeInTheDocument();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it('shows category in parentheses for forms that have one', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Form Submission'));

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    const options = screen.getAllByRole('option');
    expect(options[1]?.textContent).toBe('New Member Application (membership)');
    expect(options[2]?.textContent).toBe('Background Check Authorization');
  });

  // =========================================================================
  // Meeting Stage Type Tests
  // =========================================================================

  it('displays meeting stage type option', () => {
    render(<StageConfigModal {...defaultProps} />);
    expect(screen.getByText('Meeting')).toBeInTheDocument();
    expect(screen.getByText('Require attendance at or scheduling of a meeting.')).toBeInTheDocument();
  });

  it('shows meeting type dropdown when meeting type is selected', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Meeting'));

    expect(screen.getByLabelText('Meeting Type')).toBeInTheDocument();
    expect(screen.getByText('Meeting with Chief')).toBeInTheDocument();
    expect(screen.getByText('Informational Meeting')).toBeInTheDocument();
    expect(screen.getByText('Business Meeting')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('saves meeting stage with correct config', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Meeting'));
    await user.type(screen.getByLabelText(/stage name/i), 'Meet the Chief');
    await user.selectOptions(screen.getByLabelText('Meeting Type'), 'chief_meeting');
    await user.type(
      screen.getByLabelText(/meeting details/i),
      'Meet with Chief Smith'
    );

    await user.click(screen.getByText('Add Stage'));

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Meet the Chief',
        stage_type: 'meeting',
        config: expect.objectContaining({
          meeting_type: 'chief_meeting',
          meeting_description: 'Meet with Chief Smith',
        }) as unknown,
      })
    );
  });

  it('allows changing meeting type', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Meeting'));
    await user.selectOptions(screen.getByLabelText('Meeting Type'), 'business_meeting');

    expect(screen.getByText('Attend a regular business meeting.')).toBeInTheDocument();
  });

  // =========================================================================
  // Status Page Toggle Stage Type Tests
  // =========================================================================

  it('displays status page toggle stage type option', () => {
    render(<StageConfigModal {...defaultProps} />);
    expect(screen.getByText('Enable Status Page')).toBeInTheDocument();
    expect(screen.getByText('Activate the public status page for the prospect at this stage.')).toBeInTheDocument();
  });

  it('shows status page toggle config when selected', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Enable Status Page'));

    expect(screen.getByText(/enables the public status page/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/enable public status page at this stage/i)).toBeChecked();
  });

  it('saves status page toggle stage with correct config', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Enable Status Page'));
    await user.type(screen.getByLabelText(/stage name/i), 'Activate Status Page');
    await user.type(
      screen.getByLabelText(/custom status message/i),
      'Welcome! Track your progress here.'
    );

    await user.click(screen.getByText('Add Stage'));

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Activate Status Page',
        stage_type: 'status_page_toggle',
        config: expect.objectContaining({
          enable_public_status: true,
          custom_message: 'Welcome! Track your progress here.',
        }) as unknown,
      })
    );
  });

  // =========================================================================
  // Automated Email Stage Type Tests
  // =========================================================================

  it('displays automated email stage type option', () => {
    render(<StageConfigModal {...defaultProps} />);
    expect(screen.getByText('Automated Email')).toBeInTheDocument();
    expect(screen.getByText('Send an automated email to the prospect at this stage.')).toBeInTheDocument();
  });

  it('shows email config sections when automated email is selected', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));

    expect(screen.getByLabelText('Email Subject')).toBeInTheDocument();
    expect(screen.getByText('Welcome Message')).toBeInTheDocument();
    expect(screen.getByText('Membership FAQ Link')).toBeInTheDocument();
    expect(screen.getByText('Next Meeting Details')).toBeInTheDocument();
    expect(screen.getByText('Application Tracker Link')).toBeInTheDocument();
  });

  it('saves automated email stage with correct config', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));
    await user.type(screen.getByLabelText(/stage name/i), 'Welcome Email');

    // Subject should have a default value
    const subjectInput = screen.getByLabelText('Email Subject');
    await user.clear(subjectInput);
    await user.type(subjectInput, 'Welcome to Our Department!');

    await user.click(screen.getByText('Add Stage'));

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Welcome Email',
        stage_type: 'automated_email',
        config: expect.objectContaining({
          email_subject: 'Welcome to Our Department!',
          include_welcome: true,
        }) as unknown,
      })
    );
  });

  it('validates that email subject is required', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));
    await user.type(screen.getByLabelText(/stage name/i), 'Welcome Email');

    // Clear the default subject
    const subjectInput = screen.getByLabelText('Email Subject');
    await user.clear(subjectInput);

    await user.click(screen.getByText('Add Stage'));

    expect(screen.getByText('Email subject is required')).toBeInTheDocument();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it('can toggle optional email sections on and off', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));

    // FAQ link should be unchecked by default, check it
    const faqCheckbox = screen.getByRole('checkbox', { name: 'Membership FAQ Link' });
    expect(faqCheckbox).not.toBeChecked();
    await user.click(faqCheckbox);

    // URL input should now appear
    expect(screen.getByLabelText('FAQ URL')).toBeInTheDocument();
  });

  it('can add custom sections', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));

    await user.click(screen.getByText('Add custom section'));

    // Custom section fields should appear
    expect(screen.getByText('Custom Section')).toBeInTheDocument();
  });

  // =========================================================================
  // Event Linking Tests
  // =========================================================================

  it('fetches upcoming events when modal opens', async () => {
    render(<StageConfigModal {...defaultProps} />);
    await waitFor(() => {
      expect(mockGetEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          end_after: expect.any(String) as string,
          include_cancelled: false,
        })
      );
    });
  });

  it('shows event type picker in meeting stage config', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Meeting'));

    expect(screen.getByLabelText(/link to upcoming event/i)).toBeInTheDocument();
  });

  it('shows next upcoming event preview when event type is selected in meeting stage', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Meeting'));

    await waitFor(() => {
      expect(mockGetEvents).toHaveBeenCalled();
    });

    await user.selectOptions(screen.getByLabelText(/link to upcoming event/i), 'business_meeting');

    await waitFor(() => {
      expect(screen.getByText('March Business Meeting')).toBeInTheDocument();
    });
    expect(screen.getByText(/Station 1/)).toBeInTheDocument();
  });

  it('shows event type picker in automated email next meeting section', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));

    // Enable the next meeting section
    const meetingCheckbox = screen.getByRole('checkbox', { name: 'Next Meeting Details' });
    await user.click(meetingCheckbox);

    expect(screen.getByLabelText(/pull from upcoming event/i)).toBeInTheDocument();
  });

  it('shows next upcoming event preview in automated email when event type is selected', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));

    await waitFor(() => {
      expect(mockGetEvents).toHaveBeenCalled();
    });

    const meetingCheckbox = screen.getByRole('checkbox', { name: 'Next Meeting Details' });
    await user.click(meetingCheckbox);

    await user.selectOptions(screen.getByLabelText(/pull from upcoming event/i), 'training');

    await waitFor(() => {
      expect(screen.getByText('Spring Training Session')).toBeInTheDocument();
    });
    expect(screen.getByText(/Training Center/)).toBeInTheDocument();
  });

  it('shows no upcoming events message when no events match selected type', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Meeting'));

    await waitFor(() => {
      expect(mockGetEvents).toHaveBeenCalled();
    });

    // Select an event type with no upcoming events
    await user.selectOptions(screen.getByLabelText(/link to upcoming event/i), 'ceremony');

    await waitFor(() => {
      expect(screen.getByText(/no upcoming ceremony events found/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // All 7 Stage Types Present
  // =========================================================================

  it('shows all 7 stage type options', () => {
    render(<StageConfigModal {...defaultProps} />);
    expect(screen.getByText('Form Submission')).toBeInTheDocument();
    expect(screen.getByText('Document Upload')).toBeInTheDocument();
    expect(screen.getByText('Meeting')).toBeInTheDocument();
    expect(screen.getByText('Election / Vote')).toBeInTheDocument();
    expect(screen.getByText('Manual Approval')).toBeInTheDocument();
    expect(screen.getByText('Enable Status Page')).toBeInTheDocument();
    expect(screen.getByText('Automated Email')).toBeInTheDocument();
  });
});
