/**
 * Training setup forms, batch 1: the requirement editor follows the owner's
 * form rule (2026-11-05, docs/KNOWN_LIMITATIONS.md "Forms — Save With an
 * Error"). A new requirement is not created until every field is fixed, and
 * each refusal is said on its field rather than in a toast; an edit saves the
 * rest and keeps the refused field flagged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../contexts/ConfirmContext';

vi.mock('../../hooks/useCourseLibrary', () => ({
  useCourseLibrary: () => ({ courses: [], loading: false, error: null }),
}));

vi.mock('../../services/api', () => ({
  eventService: { getVisibleEventTypesWithCategories: () => Promise.resolve({ membership_types: [] }) },
}));

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) as unknown },
}));

import { RequirementModal } from './RequirementModal';
import type { TrainingRequirement } from '../../types/training';

const existing: TrainingRequirement = {
  id: 'req-1',
  organization_id: 'org-1',
  name: 'Annual Hours',
  description: 'Old description',
  requirement_type: 'hours',
  source: 'department',
  required_hours: 24,
  frequency: 'annual',
  year: 2026,
  applies_to_all: true,
  due_date_type: 'calendar_period',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const unprocessable = (loc: string, msg: string) =>
  Object.assign(new Error('Request failed with status code 422'), {
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc: ['body', loc], msg, type: 'value_error' }] } },
  });

const renderModal = (requirement: TrainingRequirement | null, onSave = vi.fn(), onClose = vi.fn()) =>
  render(
    <ConfirmProvider>
      <RequirementModal requirement={requirement} categories={[]} onClose={onClose} onSave={onSave} />
    </ConfirmProvider>
  );

describe('RequirementModal save (training forms batch 1)', () => {
  const onSave = vi.fn();

  beforeEach(() => {
    onSave.mockReset();
    onSave.mockResolvedValue(undefined);
    mockToastError.mockReset();
  });

  it('marks a blank name on its field and creates nothing', async () => {
    const user = userEvent.setup();
    renderModal(null, onSave);

    await user.type(screen.getByLabelText(/^Required Hours/), '8');
    await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

    const name = screen.getByLabelText(/^Name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/Give the requirement a name/);
    expect(name).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('marks a missing hours target on its field and creates nothing', async () => {
    const user = userEvent.setup();
    renderModal(null, onSave);

    await user.type(screen.getByLabelText(/^Name/), 'Annual Hazmat Hours');
    await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

    const hours = screen.getByLabelText(/^Required Hours/);
    expect(hours).toHaveAttribute('aria-invalid', 'true');
    expect(hours).toHaveAccessibleDescription(/Enter the hours/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('puts a create refused by the server on the field it names', async () => {
    onSave.mockRejectedValueOnce(unprocessable('name', 'String should have at most 255 characters'));
    const user = userEvent.setup();
    renderModal(null, onSave);

    await user.type(screen.getByLabelText(/^Name/), 'Annual Hazmat Hours');
    await user.type(screen.getByLabelText(/^Required Hours/), '8');
    await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

    const name = await screen.findByLabelText(/^Name/);
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription(/at most 255 characters/);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('saves an edit without a blank name, keeps the stored name, and flags the field', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal(existing, onSave, onClose);

    await user.clear(screen.getByLabelText(/^Name/));
    const description = screen.getByLabelText(/^Description/);
    await user.clear(description);
    await user.type(description, 'New description');
    await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
    await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [body, isEdit, id, options] = onSave.mock.calls[0] as [Record<string, unknown>, boolean, string, unknown];
    expect(isEdit).toBe(true);
    expect(id).toBe('req-1');
    expect(body).not.toHaveProperty('name');
    expect(body.description).toBe('New description');
    expect(body.required_hours).toBe(24);
    expect(options).toEqual({ keepOpen: true });

    const name = screen.getByLabelText(/^Name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Requirement saved, except name/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('resends an edit without the target the server refuses, and flags it', async () => {
    onSave.mockRejectedValueOnce(unprocessable('required_hours', 'Input should be less than or equal to 1000'));
    const user = userEvent.setup();
    renderModal(existing, onSave);

    const description = screen.getByLabelText(/^Description/);
    await user.clear(description);
    await user.type(description, 'Reworded');
    const hours = screen.getByLabelText(/^Required Hours/);
    await user.clear(hours);
    await user.type(hours, '99999');
    await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
    await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    const [resent] = onSave.mock.calls[1] as [Record<string, unknown>];
    // The type and its target travel together: leaving out only the number
    // could pair a new type with the stored target of another.
    expect(resent).not.toHaveProperty('required_hours');
    expect(resent).not.toHaveProperty('requirement_type');
    expect(resent.description).toBe('Reworded');
    expect(screen.getByLabelText(/^Required Hours/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Requirement saved, except required hours/)).toBeInTheDocument();
  });

  it('asks before discarding a changed form', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal(existing, onSave, onClose);

    await user.type(screen.getByLabelText(/^Description/), ' more');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
