import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
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

// pipeline_id matches the stages above, as the API always sends it. The board
// uses it to tell its own applicants from another pipeline's, so a fixture
// without it is not a realistic row.
const applicant = {
  id: 'app-1',
  pipeline_id: 'pipe-1',
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

// The board grouped applicants into a bucket per stage id and silently dropped
// anyone whose id matched none of them. Two ordinary cases land there: the API
// maps a null current_step_id to '', which is what a prospect is left holding
// when the stage they were on is deleted, and a stage id from a pipeline the
// board is not showing matches nothing either. Those people disappeared from
// the board entirely while the server-side total kept counting them — a board
// reading "No applicants" under a header saying there is one.
describe('PipelineKanban applicants with no stage', () => {
  const unassignedColumn = () => screen.queryByRole('group', { name: 'Unassigned applicants' });

  it('shows an applicant whose stage id is empty', () => {
    const stageless = { ...applicant, current_stage_id: '', current_stage_name: undefined };
    renderWithRouter(<PipelineKanban stages={stages} applicants={[stageless]} onApplicantClick={vi.fn()} />);

    const column = unassignedColumn();
    expect(column).not.toBeNull();
    expect(within(column as HTMLElement).getByRole('button', { name: /Riley Bishop/ })).toBeInTheDocument();
  });

  it('shows an applicant whose stage belongs to no column', () => {
    const elsewhere = { ...applicant, current_stage_id: 'deleted-stage' };
    renderWithRouter(<PipelineKanban stages={stages} applicants={[elsewhere]} onApplicantClick={vi.fn()} />);

    expect(within(unassignedColumn() as HTMLElement).getByRole('button', { name: /Riley Bishop/ })).toBeInTheDocument();
  });

  // A healthy board must look exactly as it always did.
  it('does not render the column when everyone is on a stage', () => {
    renderWithRouter(<PipelineKanban stages={stages} applicants={[applicant]} onApplicantClick={vi.fn()} />);

    expect(unassignedColumn()).toBeNull();
  });

  // There is no stage to advance from, so neither advance nor regress applies.
  // This previously fell into the same guard as an unknown drop target and did
  // nothing at all: the card sprang back with no explanation.
  it('explains why an unassigned applicant cannot be dragged onto a stage', () => {
    const stageless = { ...applicant, current_stage_id: '' };
    renderWithRouter(<PipelineKanban stages={stages} applicants={[stageless]} onApplicantClick={vi.fn()} />);

    dragTo('Interview');

    expect(mockAdvance).not.toHaveBeenCalled();
    expect(mockRegress).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('not on a stage of this pipeline'));
  });
});

// The store assigns `applicants` only on a successful fetch and its catch
// leaves the previous list alone, so switching pipeline shows the old one's
// rows until the new fetch lands — and permanently if it fails. Those rows
// match no stage on this board. Collecting them into Unassigned would put a
// card for someone else's pipeline in front of a coordinator, and opening it
// and pressing Advance moves that applicant along a workflow they are not
// looking at. A stage mismatch is only "unassigned" for this pipeline's own.
describe('PipelineKanban applicants from another pipeline', () => {
  const unassignedColumn = () => screen.queryByRole('group', { name: 'Unassigned applicants' });

  const stranger = {
    ...applicant,
    id: 'app-other',
    pipeline_id: 'pipe-2',
    first_name: 'Devon',
    last_name: 'Marsh',
    current_stage_id: 'other-pipeline-stage',
  };

  it('does not show an applicant belonging to a different pipeline', () => {
    renderWithRouter(<PipelineKanban stages={stages} applicants={[stranger]} onApplicantClick={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Devon Marsh/ })).toBeNull();
    expect(unassignedColumn()).toBeNull();
  });

  it('keeps this pipeline’s own stray and drops the other pipeline’s', () => {
    const ourStray = { ...applicant, current_stage_id: '' };
    renderWithRouter(<PipelineKanban stages={stages} applicants={[ourStray, stranger]} onApplicantClick={vi.fn()} />);

    const column = unassignedColumn();
    expect(column).not.toBeNull();
    expect(within(column as HTMLElement).getByRole('button', { name: /Riley Bishop/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Devon Marsh/ })).toBeNull();
  });
});
