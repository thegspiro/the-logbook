import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import EventProspectsCard from './EventProspectsCard';
import type { ApplicantListItem } from '../../modules/prospective-members/types';

const mockGetApplicants = vi.fn();
vi.mock('../../modules/prospective-members/services/api', () => ({
  applicantService: {
    getApplicants: (...args: unknown[]) => mockGetApplicants(...args) as unknown,
  },
}));

const mockCheckPermission = vi.fn();
const mockAuthState = { checkPermission: mockCheckPermission };
vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) =>
    selector ? selector(mockAuthState as unknown as Record<string, unknown>) : mockAuthState
  ),
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

const applicant = (over: Partial<ApplicantListItem> = {}): ApplicantListItem =>
  ({
    id: 'app-1',
    pipeline_id: 'pipe-1',
    first_name: 'Dana',
    last_name: 'Reyes',
    email: 'dana@example.org',
    current_stage_id: 'stage-1',
    current_stage_name: 'Application Review',
    stage_entered_at: '2026-09-02T12:00:00Z',
    target_membership_type: 'active',
    status: 'active',
    days_in_stage: 1,
    days_in_pipeline: 1,
    last_activity_at: '2026-09-02T12:00:00Z',
    days_since_activity: 0,
    inactivity_alert_level: 'none',
    created_at: '2026-09-02T12:00:00Z',
    ...over,
  }) as ApplicantListItem;

describe('EventProspectsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPermission.mockReturnValue(true);
    mockGetApplicants.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10, total_pages: 0 });
  });

  it('lists the applicants an event produced', async () => {
    mockGetApplicants.mockResolvedValue({
      items: [applicant(), applicant({ id: 'app-2', first_name: 'Sam', last_name: 'Okafor' })],
      total: 2,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });

    renderWithRouter(<EventProspectsCard eventId="evt-1" createsProspects />);

    expect(await screen.findByText('Dana Reyes')).toBeInTheDocument();
    expect(screen.getByText('Sam Okafor')).toBeInTheDocument();
    expect(screen.getByText(/2 applicants came from this event/i)).toBeInTheDocument();
  });

  it('filters the request to this event', async () => {
    renderWithRouter(<EventProspectsCard eventId="evt-1" createsProspects />);

    await waitFor(() =>
      expect(mockGetApplicants).toHaveBeenCalledWith({
        filters: { event_id: 'evt-1' },
        page: 1,
        pageSize: 10,
      })
    );
  });

  it('links into the pipeline filtered to this event', async () => {
    mockGetApplicants.mockResolvedValue({
      items: [applicant()],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });

    renderWithRouter(<EventProspectsCard eventId="evt-1" createsProspects />);

    const link = await screen.findByRole('link', { name: /view in pipeline/i });
    expect(link).toHaveAttribute('href', '/prospective-members?event=evt-1');
  });

  it('says so when a pipeline-enabled event has produced nobody', async () => {
    renderWithRouter(<EventProspectsCard eventId="evt-1" createsProspects />);

    expect(await screen.findByText(/nobody has been added to the pipeline/i)).toBeInTheDocument();
  });

  it('renders nothing for an event that neither feeds the pipeline nor has applicants', async () => {
    const { container } = renderWithRouter(<EventProspectsCard eventId="evt-1" createsProspects={false} />);

    await waitFor(() => expect(mockGetApplicants).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('still reports applicants on an event that no longer feeds the pipeline', async () => {
    mockGetApplicants.mockResolvedValue({
      items: [applicant()],
      total: 1,
      page: 1,
      page_size: 10,
      total_pages: 1,
    });

    renderWithRouter(<EventProspectsCard eventId="evt-1" createsProspects={false} />);

    expect(await screen.findByText('Dana Reyes')).toBeInTheDocument();
  });

  it('renders nothing, and asks for nothing, without pipeline permission', async () => {
    mockCheckPermission.mockReturnValue(false);

    const { container } = renderWithRouter(<EventProspectsCard eventId="evt-1" createsProspects />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockGetApplicants).not.toHaveBeenCalled();
  });

  it('stays quiet when the request fails', async () => {
    mockGetApplicants.mockRejectedValue(new Error('boom'));

    const { container } = renderWithRouter(<EventProspectsCard eventId="evt-1" createsProspects={false} />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
