import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getPendingSubmissions = vi.fn();

vi.mock('../services/api', () => ({
  trainingSubmissionService: {
    getConfig: () => Promise.resolve({ require_approval: true, field_config: {} }),
    getPendingCount: () => Promise.resolve({ pending_count: 1 }),
    getPendingSubmissions: (...args: unknown[]) => getPendingSubmissions(...args) as unknown,
    getAttachmentDownloadUrl: () => '',
  },
  trainingService: {},
  trainingProgramService: {
    getUserEnrollments: () => Promise.resolve([]),
    getPrograms: () => Promise.resolve([]),
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import ReviewSubmissionsPage from './ReviewSubmissionsPage';

describe('ReviewSubmissionsPage', () => {
  beforeEach(() => {
    getPendingSubmissions.mockReset();
    getPendingSubmissions.mockResolvedValue([
      {
        id: 'sub-1',
        organization_id: 'org-1',
        submitted_by: 'user-1',
        submitter_name: 'Jordan Avery',
        course_name: 'Hazmat Awareness Refresher',
        training_type: 'refresher',
        completion_date: '2026-09-27',
        expiration_date: '2028-09-27',
        hours_completed: 4,
        status: 'pending_review',
        submitted_at: '2026-09-29T03:50:00Z',
        updated_at: '2026-09-29T03:50:00Z',
      },
    ]);
  });

  it('shows calendar dates and names the notes box', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ReviewSubmissionsPage />);

    await user.click(await screen.findByRole('button', { name: /Hazmat Awareness Refresher/ }));

    expect(screen.getByText('Sep 27, 2026')).toBeInTheDocument();
    expect(screen.getByText('Sep 27, 2028')).toBeInTheDocument();
    expect(screen.queryByText('2026-09-27')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Notes for the member' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Request Revision' }));
    expect(screen.getByRole('textbox', { name: 'Reason for the member (required)' })).toBeInTheDocument();
  });
});
