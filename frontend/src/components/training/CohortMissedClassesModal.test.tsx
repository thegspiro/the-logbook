import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CohortMissedClass } from '../../types/training';

const listMissedClasses = vi.fn();
const creditMissedClass = vi.fn();
const scheduleMakeup = vi.fn();

vi.mock('../../services/api', () => ({
  courseCohortService: {
    listMissedClasses: (...a: unknown[]) => listMissedClasses(...a) as unknown,
    creditMissedClass: (...a: unknown[]) => creditMissedClass(...a) as unknown,
    scheduleMakeup: (...a: unknown[]) => scheduleMakeup(...a) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
const mockConfirm = vi.fn();
vi.mock('../../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: (...a: unknown[]) => mockConfirm(...a) as unknown }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { CohortMissedClassesModal } from './CohortMissedClassesModal';

const missed = (overrides: Partial<CohortMissedClass> = {}): CohortMissedClass => ({
  cohort_class_id: 'class-1',
  sequence: 1,
  title: 'Ladders',
  scheduled_start: '2026-09-01T23:00:00Z',
  scheduled_end: '2026-09-02T02:00:00Z',
  credit_hours: 3,
  resolution: null,
  pending: true,
  ...overrides,
});

const onChanged = vi.fn();

const renderModal = () =>
  render(
    <CohortMissedClassesModal
      isOpen
      cohortId="cohort-1"
      userId="user-1"
      memberName="Pat Late"
      onClose={vi.fn()}
      onChanged={onChanged}
    />
  );

describe('CohortMissedClassesModal', () => {
  beforeEach(() => {
    listMissedClasses.mockReset();
    creditMissedClass.mockReset();
    scheduleMakeup.mockReset();
    onChanged.mockReset();
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(true);
    listMissedClasses.mockResolvedValue([missed()]);
    creditMissedClass.mockResolvedValue({ missed_class: missed(), warnings: [] });
    scheduleMakeup.mockResolvedValue({ missed_class: missed(), warnings: [] });
  });

  it('offers both decisions for a class still undecided', async () => {
    renderModal();

    expect(await screen.findByText('1. Ladders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Credit as completed/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Schedule make-up/ })).toBeInTheDocument();
  });

  it('credits the class once the officer confirms', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /Credit as completed/ }));

    await waitFor(() => expect(creditMissedClass).toHaveBeenCalledWith('cohort-1', 'user-1', 'class-1'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Credit as completed' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('credits nothing when the confirmation is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /Credit as completed/ }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(creditMissedClass).not.toHaveBeenCalled();
  });

  it('shows what was decided instead of the actions once decided', async () => {
    listMissedClasses.mockResolvedValue([missed({ resolution: 'credited', pending: false })]);
    renderModal();

    expect(await screen.findByText('Credited as completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Schedule make-up/ })).not.toBeInTheDocument();
  });

  it('asks again when a make-up session was cancelled', async () => {
    listMissedClasses.mockResolvedValue([
      missed({ resolution: 'makeup_scheduled', pending: true, makeup_status: 'cancelled' }),
    ]);
    renderModal();

    expect(await screen.findByText(/Make-up session was cancelled/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Credit as completed/ })).toBeInTheDocument();
  });
});
