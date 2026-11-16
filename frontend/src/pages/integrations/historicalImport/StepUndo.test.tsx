import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { UndoPreview, UndoStepPreview } from '../../../modules/integrations/types/historicalImport';

const mockPreview = vi.fn();
const mockUndo = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    getUndoPreview: (...a: unknown[]) => mockPreview(...a) as unknown,
    undoStep: (...a: unknown[]) => mockUndo(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import StepUndo from './StepUndo';

const step = (overrides: Partial<UndoStepPreview> = {}): UndoStepPreview => ({
  committed: true,
  blocked_by: [],
  removable: 40,
  kept_total: 1,
  kept: [{ kind: 'training_record', record_id: 'r-1', label: 'EMT-B (2016-03-11)' }],
  already_gone: 0,
  ...overrides,
});

const view = (training: UndoStepPreview): UndoPreview => ({
  steps: { training, drills: step({ committed: false }), admin: step({ committed: false }) },
  members_created: 2,
});

describe('StepUndo', () => {
  const onUndone = vi.fn();

  beforeEach(() => {
    for (const mock of [mockPreview, mockUndo, onUndone]) mock.mockReset();
    mockPreview.mockResolvedValue(view(step()));
    mockUndo.mockResolvedValue({
      step: 'training',
      removed: 40,
      kept: 1,
      members_removed: 2,
      members_kept: 0,
      preview: view(step({ committed: false, removable: 0 })),
    });
  });

  it('undoes the step after confirmation and lists what it kept', async () => {
    // Committed when the control loads; undone when it re-reads afterwards.
    mockPreview.mockResolvedValueOnce(view(step()));
    mockPreview.mockResolvedValue(view(step({ committed: false, removable: 0 })));
    const user = userEvent.setup();
    renderWithRouter(<StepUndo importId="hist-1" step="training" noun="training records" onUndone={onUndone} />);
    await user.click(await screen.findByRole('button', { name: 'Undo this step' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('40 records are removed.');
    expect(dialog).toHaveTextContent('1 record was changed since the import and is kept.');
    expect(dialog).toHaveTextContent('Former members this import created are removed too');
    await user.click(within(dialog).getByRole('button', { name: 'Undo this step' }));

    await waitFor(() => expect(mockUndo).toHaveBeenCalledWith('hist-1', 'training'));
    expect(onUndone).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('1 record was kept');
    expect(screen.getByText('EMT-B (2016-03-11)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo this step' })).not.toBeInTheDocument();
  });

  it('says which later step must be undone first', async () => {
    mockPreview.mockResolvedValue(view(step({ blocked_by: ['company drills'] })));
    renderWithRouter(<StepUndo importId="hist-1" step="training" noun="training records" onUndone={onUndone} />);

    expect(await screen.findByRole('button', { name: 'Undo this step' })).toBeDisabled();
    expect(screen.getByText(/first undo the company drills step/)).toBeInTheDocument();
  });

  it('shows nothing for a step that has not been committed', async () => {
    mockPreview.mockResolvedValue(view(step({ committed: false })));
    renderWithRouter(<StepUndo importId="hist-1" step="training" noun="training records" onUndone={onUndone} />);

    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('hist-1'));
    expect(screen.queryByRole('button', { name: 'Undo this step' })).not.toBeInTheDocument();
  });

  it('says the roster leaves the shifts and seats it only used', async () => {
    mockPreview.mockResolvedValue({
      steps: { staffing: step({ reused: 3, kept_total: 0, kept: [] }) },
      members_created: 0,
    });
    const user = userEvent.setup();
    renderWithRouter(
      <StepUndo importId="hist-1" step="staffing" noun="roster's shifts, seats and events" onUndone={onUndone} />
    );
    await user.click(await screen.findByRole('button', { name: 'Undo this step' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(
      '3 shifts and seats it used but did not make are left as they are; a member it moved to another seat keeps that seat.'
    );
  });
});
