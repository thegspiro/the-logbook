import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../hooks/useCourseLibrary', () => ({
  useCourseLibrary: () => ({ courses: [], loading: false, error: null }),
}));

import { RequirementModal } from './RequirementModal';
import type { TrainingRequirement } from '../../types/training';

const existing = (overrides: Partial<TrainingRequirement> = {}): TrainingRequirement => ({
  id: 'req-1',
  organization_id: 'org-1',
  name: 'Annual Hours',
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
  ...overrides,
});

describe('RequirementModal', () => {
  const onSave = vi.fn();

  beforeEach(() => {
    onSave.mockReset();
  });

  it('saves once when Create is pressed again while the first save is in flight', async () => {
    let finish: () => void = () => undefined;
    onSave.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<RequirementModal categories={[]} onClose={vi.fn()} onSave={onSave} />);

    await user.type(screen.getByLabelText(/^Name/), 'Annual Hazmat Hours');
    await user.type(screen.getByLabelText(/^Required Hours/), '8');
    await user.dblClick(screen.getByRole('button', { name: 'Create Requirement' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

    finish();
    expect(await screen.findByRole('button', { name: 'Create Requirement' })).toBeEnabled();
  });

  describe('existing members', () => {
    it('sends a cutoff when existing members are exempted on create', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Live Fire');
      await user.type(screen.getByLabelText(/^Required Hours/), '8');
      await user.click(screen.getByRole('radio', { name: /Exempt existing members/ }));
      await user.clear(screen.getByLabelText('Existing members joined before'));
      await user.type(screen.getByLabelText('Existing members joined before'), '2026-07-01');
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ new_member_cutoff_date: '2026-07-01', existing_member_deadline: null }),
        false,
        undefined
      );
    });

    it('will not save a catch-up period without its deadline', async () => {
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Live Fire');
      await user.type(screen.getByLabelText(/^Required Hours/), '8');
      await user.click(screen.getByRole('radio', { name: /Give a catch-up deadline/ }));
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('saving an edit', () => {
    it('asks who the change reaches before saving, and saves for everyone by default', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<RequirementModal requirement={existing()} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));

      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByText('Who does this change apply to?')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ apply_to: 'everyone', new_member_cutoff_date: null }),
        true,
        'req-1'
      );
      expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('effective_date');
    });

    it('saves for new members only from the chosen date', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<RequirementModal requirement={existing()} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.clear(screen.getByLabelText(/^Required Hours/));
      await user.type(screen.getByLabelText(/^Required Hours/), '36');
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('radio', { name: /New members only/ }));
      const date = screen.getByLabelText(/New standard applies to members who joined on or after/);
      await user.clear(date);
      await user.type(date, '2026-11-01');
      await user.click(screen.getByRole('button', { name: 'Save for new members' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          apply_to: 'new_members_only',
          effective_date: '2026-11-01',
          required_hours: 36,
        }),
        true,
        'req-1'
      );
    });

    it('keeps editing without saving when the prompt is dismissed', async () => {
      const user = userEvent.setup();
      render(<RequirementModal requirement={existing()} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Keep editing' }));

      expect(onSave).not.toHaveBeenCalled();
      expect(screen.queryByText('Who does this change apply to?')).not.toBeInTheDocument();
    });

    it('offers only "everyone" on the earlier standard of a past split', async () => {
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={existing({ applies_to_joined_before: '2026-07-01' })}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));

      expect(screen.queryByRole('radio', { name: /New members only/ })).not.toBeInTheDocument();
      expect(screen.getByText(/edit the newer copy instead/)).toBeInTheDocument();
    });
  });
});
