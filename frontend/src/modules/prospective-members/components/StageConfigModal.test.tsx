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
  formatDateTime: (d: string) => new Date(d).toISOString(),
}));

import { StageConfigModal } from './StageConfigModal';
import type { PipelineStageCreate } from '../types';

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
    // jsdom does not implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
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
    expect(screen.getByText('Meeting with President')).toBeInTheDocument();
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

    // Welcome message is required when include_welcome is checked (default)
    await user.type(screen.getByLabelText('Welcome message content'), 'Hello!');

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

  it('can type in custom section title and content after adding', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));
    await user.click(screen.getByText('Add custom section'));

    const titleInput = screen.getByLabelText('Custom section 1 title');
    const contentInput = screen.getByLabelText('Custom section 1 content');

    await user.type(titleInput, 'Important Info');
    await user.type(contentInput, 'Here is some custom content');

    expect(titleInput).toHaveValue('Important Info');
    expect(contentInput).toHaveValue('Here is some custom content');
  });

  it('can add multiple custom sections', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));
    await user.click(screen.getByText('Add custom section'));
    await user.click(screen.getByText('Add custom section'));

    expect(screen.getByLabelText('Custom section 1 title')).toBeInTheDocument();
    expect(screen.getByLabelText('Custom section 2 title')).toBeInTheDocument();
  });

  it('can remove a custom section', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));
    await user.click(screen.getByText('Add custom section'));

    expect(screen.getByText('Custom Section')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Remove custom section 1'));

    expect(screen.queryByText('Custom Section')).not.toBeInTheDocument();
  });

  it('preserves custom sections when editing an existing automated email stage', async () => {
    const user = userEvent.setup();
    const editingStage = {
      id: 'stage-1',
      pipeline_id: 'pipeline-1',
      name: 'Welcome Email',
      description: 'Send welcome info',
      stage_type: 'automated_email' as const,
      config: {
        email_subject: 'Welcome!',
        include_welcome: true,
        welcome_message: 'Hello there',
        include_faq_link: false,
        include_next_meeting: false,
        include_status_tracker: false,
        custom_sections: [
          { id: 'existing-1', title: 'Parking Info', content: 'Park in lot B', enabled: true },
        ],
      },
      sort_order: 0,
      is_required: true,
      notify_prospect_on_completion: false,
      public_visible: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    render(
      <StageConfigModal
        {...defaultProps}
        editingStage={editingStage}
      />
    );

    // Existing custom section should be visible with its data
    const titleInput = screen.getByLabelText('Custom section 1 title');
    expect(titleInput).toHaveValue('Parking Info');
    const contentInput = screen.getByLabelText('Custom section 1 content');
    expect(contentInput).toHaveValue('Park in lot B');

    // Should be able to add another custom section
    await user.click(screen.getByText('Add custom section'));
    expect(screen.getByLabelText('Custom section 2 title')).toBeInTheDocument();

    // Should be able to type in the new section
    const newTitleInput = screen.getByLabelText('Custom section 2 title');
    await user.type(newTitleInput, 'Dress Code');
    expect(newTitleInput).toHaveValue('Dress Code');
  });

  it('saves custom sections in the stage config when submitting', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<StageConfigModal {...defaultProps} onSave={onSave} />);

    // Set required fields
    await user.type(screen.getByLabelText(/stage name/i), 'Welcome Email');
    await user.click(screen.getByText('Automated Email'));

    // Fill in welcome message (required when include_welcome is checked)
    await user.type(screen.getByLabelText('Welcome message content'), 'Welcome!');

    // Add a custom section
    await user.click(screen.getByText('Add custom section'));
    await user.type(screen.getByLabelText('Custom section 1 title'), 'Important');
    await user.type(screen.getByLabelText('Custom section 1 content'), 'Details here');

    // Save
    await user.click(screen.getByText('Add Stage'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedData = onSave.mock.calls[0]?.[0] as PipelineStageCreate | undefined;
    const customSections = savedData?.config?.custom_sections as Array<Record<string, unknown>> | undefined;
    expect(customSections).toHaveLength(1);
    expect(customSections?.[0]).toMatchObject({
      title: 'Important',
      content: 'Details here',
      enabled: true,
    });
  });

  // =========================================================================
  // Section Order Tests
  // =========================================================================

  it('includes section_order in saved config for automated email stages', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<StageConfigModal {...defaultProps} onSave={onSave} />);

    await user.click(screen.getByText('Automated Email'));
    await user.type(screen.getByLabelText(/stage name/i), 'Welcome Email');
    await user.type(screen.getByLabelText('Welcome message content'), 'Hello!');

    await user.click(screen.getByText('Add Stage'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedData = onSave.mock.calls[0]?.[0] as PipelineStageCreate | undefined;
    expect(savedData?.config?.section_order).toEqual(
      expect.arrayContaining(['welcome', 'faq_link', 'next_meeting', 'status_tracker'])
    );
    expect(savedData?.config?.section_order).toHaveLength(4);
  });

  it('adds custom section IDs to section_order when custom sections are added', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<StageConfigModal {...defaultProps} onSave={onSave} />);

    await user.click(screen.getByText('Automated Email'));
    await user.type(screen.getByLabelText(/stage name/i), 'Welcome Email');
    await user.type(screen.getByLabelText('Welcome message content'), 'Hello!');

    // Add two custom sections
    await user.click(screen.getByText('Add custom section'));
    await user.click(screen.getByText('Add custom section'));

    await user.click(screen.getByText('Add Stage'));

    const savedData = onSave.mock.calls[0]?.[0] as PipelineStageCreate | undefined;
    const sectionOrder = savedData?.config?.section_order as string[] | undefined;
    // 4 built-in + 2 custom
    expect(sectionOrder).toHaveLength(6);
    // First 4 are the built-in ones
    expect(sectionOrder?.slice(0, 4)).toEqual([
      'welcome', 'faq_link', 'next_meeting', 'status_tracker',
    ]);
  });

  it('removes custom section ID from section_order when section is deleted', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<StageConfigModal {...defaultProps} onSave={onSave} />);

    await user.click(screen.getByText('Automated Email'));
    await user.type(screen.getByLabelText(/stage name/i), 'Welcome Email');
    await user.type(screen.getByLabelText('Welcome message content'), 'Hello!');

    // Add a custom section then remove it
    await user.click(screen.getByText('Add custom section'));
    await user.click(screen.getByLabelText('Remove custom section 1'));

    await user.click(screen.getByText('Add Stage'));

    const savedData = onSave.mock.calls[0]?.[0] as PipelineStageCreate | undefined;
    // Should be back to just 4 built-in
    expect(savedData?.config?.section_order).toHaveLength(4);
  });

  it('handles editing a stage saved without section_order (backward compat)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const editingStage = {
      id: 'stage-old',
      pipeline_id: 'pipeline-1',
      name: 'Legacy Email',
      description: '',
      stage_type: 'automated_email' as const,
      config: {
        email_subject: 'Welcome!',
        include_welcome: true,
        welcome_message: 'Hello',
        include_faq_link: false,
        include_next_meeting: false,
        include_status_tracker: false,
        custom_sections: [
          { id: 'cs-1', title: 'Info', content: 'Some info', enabled: true },
        ],
        // NOTE: no section_order — simulates a stage saved before the feature
      },
      sort_order: 0,
      is_required: true,
      notify_prospect_on_completion: false,
      public_visible: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    render(<StageConfigModal {...defaultProps} onSave={onSave} editingStage={editingStage} />);

    // Sections should still render correctly
    expect(screen.getByLabelText('Custom section 1 title')).toHaveValue('Info');

    await user.click(screen.getByText('Update Stage'));

    const savedData = onSave.mock.calls[0]?.[0] as PipelineStageCreate | undefined;
    // section_order should be auto-populated with default + custom IDs
    expect(savedData?.config?.section_order).toEqual(
      expect.arrayContaining(['welcome', 'faq_link', 'next_meeting', 'status_tracker', 'cs-1'])
    );
    expect(savedData?.config?.section_order).toHaveLength(5);
  });

  // =========================================================================
  // Email Preview Tests
  // =========================================================================

  it('toggles email preview on and off', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));

    // Preview should not be visible by default
    expect(screen.queryByTestId('email-preview')).not.toBeInTheDocument();

    // Click "Show Preview"
    await user.click(screen.getByText('Show Preview'));
    expect(screen.getByTestId('email-preview')).toBeInTheDocument();

    // Click "Hide Preview"
    await user.click(screen.getByText('Hide Preview'));
    expect(screen.queryByTestId('email-preview')).not.toBeInTheDocument();
  });

  it('shows enabled sections in email preview', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));
    await user.click(screen.getByText('Show Preview'));

    const preview = screen.getByTestId('email-preview');
    // Welcome is enabled by default
    expect(preview).toHaveTextContent('Hi Prospect');
    // Organization header
    expect(preview).toHaveTextContent('Organization Name');
  });

  it('shows custom sections in email preview', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));

    // Add a custom section with content
    await user.click(screen.getByText('Add custom section'));
    await user.type(screen.getByLabelText('Custom section 1 title'), 'Parking');
    await user.type(screen.getByLabelText('Custom section 1 content'), 'Lot B');

    await user.click(screen.getByText('Show Preview'));

    const preview = screen.getByTestId('email-preview');
    expect(preview).toHaveTextContent('Parking');
    expect(preview).toHaveTextContent('Lot B');
  });

  it('hides disabled sections in email preview', async () => {
    const user = userEvent.setup();
    render(<StageConfigModal {...defaultProps} />);

    await user.click(screen.getByText('Automated Email'));

    // Welcome is on by default, turn it off
    const welcomeCheckbox = screen.getByRole('checkbox', { name: 'Welcome Message' });
    await user.click(welcomeCheckbox);

    await user.click(screen.getByText('Show Preview'));

    const preview = screen.getByTestId('email-preview');
    // FAQ is also off by default, so we should see the fallback
    expect(preview).toHaveTextContent('Your membership application has been updated');
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
      expect(mockGetEvents).toHaveBeenCalledWith();
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
      expect(mockGetEvents).toHaveBeenCalledWith();
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
      expect(mockGetEvents).toHaveBeenCalledWith();
    });

    // Select an event type with no upcoming events
    await user.selectOptions(screen.getByLabelText(/link to upcoming event/i), 'ceremony');

    await waitFor(() => {
      expect(screen.getByText(/no upcoming ceremony events found/i)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // All 12 Stage Types Present
  // =========================================================================

  it('shows all 12 stage type options', () => {
    render(<StageConfigModal {...defaultProps} />);
    expect(screen.getByText('Form Submission')).toBeInTheDocument();
    expect(screen.getByText('Document Upload')).toBeInTheDocument();
    expect(screen.getByText('Meeting')).toBeInTheDocument();
    expect(screen.getByText('Election / Vote')).toBeInTheDocument();
    expect(screen.getByText('Manual Approval')).toBeInTheDocument();
    expect(screen.getByText('Enable Status Page')).toBeInTheDocument();
    expect(screen.getByText('Automated Email')).toBeInTheDocument();
    expect(screen.getByText('Reference Check')).toBeInTheDocument();
    expect(screen.getByText('Checklist')).toBeInTheDocument();
    expect(screen.getByText('Interview Requirement')).toBeInTheDocument();
    expect(screen.getByText('Multi-Signer Approval')).toBeInTheDocument();
    expect(screen.getByText('Medical Screening')).toBeInTheDocument();
  });
});
