import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const getPendingSubmissions = vi.fn();
const getConfig = vi.fn();
const updateConfig = vi.fn();
const approveCrewBatch = vi.fn();

vi.mock('../services/api', () => ({
  trainingSubmissionService: {
    getConfig: (...args: unknown[]) => getConfig(...args) as unknown,
    updateConfig: (...args: unknown[]) => updateConfig(...args) as unknown,
    getPendingCount: () => Promise.resolve({ pending_count: 1 }),
    getPendingSubmissions: (...args: unknown[]) => getPendingSubmissions(...args) as unknown,
    getAttachmentDownloadUrl: () => '',
    approveCrewBatch: (...args: unknown[]) => approveCrewBatch(...args) as unknown,
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
    getConfig.mockReset();
    getConfig.mockResolvedValue({ require_approval: true, approval_deadline_days: 14, field_config: {} });
    updateConfig.mockReset();
    updateConfig.mockImplementation((updates: Record<string, unknown>) =>
      Promise.resolve({ require_approval: true, approval_deadline_days: 14, field_config: {}, ...updates })
    );
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

  describe('crew-recorded training', () => {
    const crewEntry = (id: string, name: string) => ({
      id,
      organization_id: 'org-1',
      submitted_by: `user-${id}`,
      submitter_name: name,
      recorded_by: 'officer-1',
      recorder_name: 'Lee Crew',
      crew_batch_id: 'batch-1',
      course_name: 'Hose Advancement Drill',
      training_type: 'skills_practice',
      completion_date: '2026-10-11',
      hours_completed: 0.75,
      status: 'pending_review',
      submitted_at: '2026-10-11T18:00:00Z',
      updated_at: '2026-10-11T18:00:00Z',
    });

    beforeEach(() => {
      getPendingSubmissions.mockReset();
      getPendingSubmissions.mockResolvedValue([crewEntry('a', 'Ana Crew'), crewEntry('b', 'Ben Crew')]);
      approveCrewBatch.mockReset();
      approveCrewBatch.mockResolvedValue({ approved: 2, skipped: [] });
    });

    it('groups the crew under one heading and approves it in one action', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ReviewSubmissionsPage />);

      const group = await screen.findByRole('region', { name: 'Crew training: Hose Advancement Drill' });
      expect(group).toHaveTextContent('Recorded by Lee Crew');
      expect(group).toHaveTextContent('2 members');

      await user.click(screen.getByRole('button', { name: 'Approve all 2' }));
      expect(approveCrewBatch).toHaveBeenCalledWith('batch-1');
    });

    it('lets the reviewer open one member, but not send it back to them', async () => {
      const user = userEvent.setup();
      renderWithRouter(<ReviewSubmissionsPage />);

      await user.click(await screen.findByRole('button', { name: /Ana Crew/ }));

      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Request Revision' })).not.toBeInTheDocument();
    });
  });

  describe('certificate file retention', () => {
    const openSettings = async () => {
      const user = userEvent.setup();
      renderWithRouter(<ReviewSubmissionsPage />);
      await user.click(await screen.findByRole('button', { name: 'Settings' }));
      return { user, input: await screen.findByLabelText('Delete certificate files after (days)') };
    };

    it('keeps files indefinitely unless a period is entered', async () => {
      const { user } = await openSettings();

      await user.click(screen.getByRole('button', { name: /Save Configuration/ }));

      expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ attachment_retention_days: null }));
    });

    it('saves the period a department sets', async () => {
      const { user, input } = await openSettings();

      await user.type(input, '730');
      await user.click(screen.getByRole('button', { name: /Save Configuration/ }));

      expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ attachment_retention_days: 730 }));
    });

    it('refuses a period under the floor before it reaches the server', async () => {
      const { user, input } = await openSettings();

      await user.type(input, '30');

      expect(screen.getByRole('alert')).toHaveTextContent('at least 90 days');
      expect(screen.getByRole('button', { name: /Save Configuration/ })).toBeDisabled();
    });
  });
});
