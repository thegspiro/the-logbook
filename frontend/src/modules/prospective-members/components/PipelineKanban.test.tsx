import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import { PipelineKanban } from './PipelineKanban';
import type { PipelineStage, ApplicantListItem } from '../types';

const mockAdvance = vi.fn();
const mockRegress = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('../store/prospectiveMembersStore', () => ({
  useProspectiveMembersStore: () => ({
    advanceApplicant: (...a: unknown[]) => mockAdvance(...a) as unknown,
    regressApplicant: (...a: unknown[]) => mockRegress(...a) as unknown,
    isAdvancing: false,
    isRegressing: false,
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
  },
}));

const stage = (id: string, name: string, sortOrder: number): PipelineStage =>
  ({
    id,
    pipeline_id: 'pipe-1',
    name,
    stage_type: 'manual_approval',
    config: {},
    sort_order: sortOrder,
    is_required: true,
    notify_prospect_on_completion: false,
    public_visible: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }) as unknown as PipelineStage;

const stages = [stage('s1', 'Application', 0), stage('s2', 'Interview', 1), stage('s3', 'Vote', 2)];

const applicant = {
  id: 'app-1',
  first_name: 'Riley',
  last_name: 'Bishop',
  email: 'riley@example.com',
  status: 'active',
  current_stage_id: 's2',
  current_stage_name: 'Interview',
} as unknown as ApplicantListItem;

// jsdom does not implement DataTransfer, and React's synthetic drag events
// read `effectAllowed` / `dropEffect` off it — without a stub every drag in
// this file throws on a null property write before reaching the handler.
const dataTransfer = () => ({ effectAllowed: '', dropEffect: '' });

/** Drag `applicant` onto the column whose heading is `stageName`. */
const dragTo = (stageName: string) => {
  const card = screen.getByRole('button', { name: /Riley Bishop/ });
  const column = screen.getByRole('group', { name: `${stageName} stage` });
  fireEvent.dragStart(card, { dataTransfer: dataTransfer() });
  fireEvent.dragOver(column, { dataTransfer: dataTransfer() });
  fireEvent.drop(column, { dataTransfer: dataTransfer() });
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdvance.mockResolvedValue(undefined);
  mockRegress.mockResolvedValue(undefined);
});

describe('PipelineKanban drag-and-drop', () => {
  it('advances an applicant dropped on the next stage', async () => {
    renderWithRouter(<PipelineKanban stages={stages} applicants={[applicant]} onApplicantClick={vi.fn()} />);

    dragTo('Vote');

    expect(mockAdvance).toHaveBeenCalledWith('app-1');
    expect(mockRegress).not.toHaveBeenCalled();
  });

  // The board refused every backward drop with "Applicants can only be
  // advanced to the next stage", so the one gesture a coordinator reaches for
  // to undo a mis-drop did nothing but scold them — the Back button in the
  // detail drawer was the only way back.
  it('moves an applicant back when dropped on the previous stage', async () => {
    renderWithRouter(<PipelineKanban stages={stages} applicants={[applicant]} onApplicantClick={vi.fn()} />);

    dragTo('Application');

    expect(mockRegress).toHaveBeenCalledWith('app-1');
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  // Stages in between would be neither completed nor skipped, so a jump has no
  // single meaning to pick — it is refused rather than guessed at.
  it('refuses a drop that skips over a stage, and says so', () => {
    const farAway = { ...applicant, current_stage_id: 's1' };
    renderWithRouter(<PipelineKanban stages={stages} applicants={[farAway]} onApplicantClick={vi.fn()} />);

    dragTo('Vote');

    expect(mockAdvance).not.toHaveBeenCalled();
    expect(mockRegress).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('one stage at a time'));
  });

  it('does not move an applicant who is not active', () => {
    const held = { ...applicant, status: 'on_hold' };
    renderWithRouter(<PipelineKanban stages={stages} applicants={[held]} onApplicantClick={vi.fn()} />);

    dragTo('Application');

    expect(mockRegress).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('Only active applicants'));
  });

  it('does nothing when dropped back on the stage it came from', () => {
    renderWithRouter(<PipelineKanban stages={stages} applicants={[applicant]} onApplicantClick={vi.fn()} />);

    dragTo('Interview');

    expect(mockAdvance).not.toHaveBeenCalled();
    expect(mockRegress).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
