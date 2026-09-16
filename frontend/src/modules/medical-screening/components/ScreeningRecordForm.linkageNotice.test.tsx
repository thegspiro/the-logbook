/**
 * Guard: the "Add Record" dialog has no control for `user_id` / `prospect_id`
 * at all (MS-13, docs/security-review/MS-09-medical-screening.md), so every
 * record it creates is orphaned — it counts toward nobody's compliance and
 * shows as "Unknown" everywhere records are listed. See
 * docs/KNOWN_LIMITATIONS.md "Medical Screening — The Add Record Form
 * Attaches to Nobody".
 *
 * Wiring a member/prospect picker is a feature (a new data source, and a
 * decision on whether both, either, or neither may be set — the sibling gap
 * `create_record` doesn't enforce exactly-one-of `user_id`/`prospect_id`
 * already tracks that half) and is flagged rather than fixed here. This test
 * pins the interim honesty fix instead: the create dialog must say so, the
 * same "not enforced yet" idiom `ScreeningRequirementForm` already uses for
 * its own unwired fields, so a success toast can no longer imply the record
 * is attached to anyone. The edit dialog never touches these fields (the
 * update schema doesn't accept them), so it carries no such notice.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScreeningRecordForm } from './ScreeningRecordForm';
import type { ScreeningRecord } from '../types';

const baseRecord: ScreeningRecord = {
  id: 'rec-1',
  organization_id: 'org-1',
  screening_type: 'physical_exam',
  status: 'passed',
  scheduled_date: '2026-01-01',
  completed_date: '2026-01-05',
  expiration_date: '2027-01-05',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-05T00:00:00Z',
};

describe('ScreeningRecordForm — orphaned-record notice (MS-13)', () => {
  it('warns on the create dialog that the record cannot be linked to anyone', () => {
    render(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/not linked to a member or prospect/i, { exact: false })).toBeInTheDocument();
  });

  it('does not show the notice on the edit dialog', () => {
    render(<ScreeningRecordForm record={baseRecord} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/not linked to a member or prospect/i)).not.toBeInTheDocument();
  });
});
