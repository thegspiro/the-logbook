import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TrainingSubmission } from '../../../types/training';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import { RevisionNotice } from './RevisionNotice';

const submission: TrainingSubmission = {
  id: 'sub-1',
  organization_id: 'org-1',
  submitted_by: 'user-1',
  course_name: 'Hazmat Awareness Refresher',
  training_type: 'refresher',
  completion_date: '2026-09-27',
  hours_completed: 4,
  status: 'revision_requested',
  reviewer_notes: 'Please attach the certificate of completion.',
  // 11:55 PM on Sep 28 in Chicago, already Sep 29 in UTC.
  reviewed_at: '2026-09-29T04:55:00Z',
  submitted_at: '2026-09-29T03:50:00Z',
  updated_at: '2026-09-29T04:55:00Z',
};

describe('RevisionNotice', () => {
  it('dates the return on the department calendar, not the UTC one', () => {
    render(<RevisionNotice submission={submission} onFix={vi.fn()} onWithdraw={vi.fn()} />);

    expect(screen.getByText(/Returned Sep 28 ·/)).toBeInTheDocument();
  });
});
