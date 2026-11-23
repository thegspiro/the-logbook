import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../contexts/ConfirmContext';

// The editor asks before discarding a changed form, which needs the provider
// the app shell mounts.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ConfirmProvider });

vi.mock('../../hooks/useCourseLibrary', () => ({
  useCourseLibrary: () => ({ courses: [], loading: false, error: null }),
}));

const getVisibleEventTypesWithCategories = vi.fn();
vi.mock('../../services/api', () => ({
  eventService: {
    getVisibleEventTypesWithCategories: (...args: unknown[]) => getVisibleEventTypesWithCategories(...args) as unknown,
  },
}));

import { RequirementModal } from './RequirementModal';
import type { TrainingCategory, TrainingRequirement } from '../../types/training';

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
    getVisibleEventTypesWithCategories.mockReset();
    getVisibleEventTypesWithCategories.mockResolvedValue({ membership_types: [] });
  });

  it('saves once when Create is pressed again while the first save is in flight', async () => {
    let finish: () => void = () => undefined;
    onSave.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

    await user.type(screen.getByLabelText(/^Name/), 'Annual Hazmat Hours');
    await user.type(screen.getByLabelText(/^Required Hours/), '8');
    await user.dblClick(screen.getByRole('button', { name: 'Create Requirement' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

    finish();
    expect(await screen.findByRole('button', { name: 'Create Requirement' })).toBeEnabled();
  });

  describe('operational members shortcut', () => {
    const scoped = (types: string[]) => existing({ applies_to_all: false, required_membership_types: types });

    const saveAsEveryone = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));
    };

    beforeEach(() => {
      onSave.mockReset();
      onSave.mockResolvedValue(undefined);
    });

    it('ticks every operational type and leaves another category as it was', async () => {
      const user = userEvent.setup();
      render(
        <RequirementModal requirement={scoped(['administrative'])} categories={[]} onClose={vi.fn()} onSave={onSave} />
      );

      const shortcut = screen.getByRole('button', { name: 'Operational members' });
      expect(shortcut).toHaveAttribute('aria-pressed', 'false');
      await user.click(shortcut);

      expect(shortcut).toHaveAttribute('aria-pressed', 'true');
      for (const name of ['Active', 'Probationary', 'Life', 'Administrative']) {
        expect(screen.getByRole('checkbox', { name })).toBeChecked();
      }
      for (const name of ['Retired', 'Honorary']) {
        expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
      }

      await saveAsEveryone(user);
      const [payload] = onSave.mock.calls[0] as [{ required_membership_types: string[] }];
      expect([...payload.required_membership_types].sort()).toEqual([
        'active',
        'administrative',
        'life',
        'probationary',
      ]);
    });

    describe('in a department with a Senior tier', () => {
      beforeEach(() => {
        getVisibleEventTypesWithCategories.mockReset();
        getVisibleEventTypesWithCategories.mockResolvedValue({
          membership_types: [
            { value: 'probationary', label: 'Probationary' },
            { value: 'active', label: 'Active Member' },
            { value: 'senior', label: 'Senior Member' },
            { value: 'life', label: 'Life Member' },
          ],
        });
      });

      it('ticks Senior along with the built-in operational types, and says so', async () => {
        const user = userEvent.setup();
        render(
          <RequirementModal
            requirement={scoped(['administrative'])}
            categories={[]}
            onClose={vi.fn()}
            onSave={onSave}
          />
        );

        expect(
          await screen.findByText(
            /^Active, Probationary, Life and Senior Member — the operational members still serving/
          )
        ).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Operational members' }));
        expect(screen.getByRole('checkbox', { name: 'Senior Member' })).toBeChecked();

        await saveAsEveryone(user);
        const [payload] = onSave.mock.calls[0] as [{ required_membership_types: string[] }];
        expect([...payload.required_membership_types].sort()).toEqual([
          'active',
          'administrative',
          'life',
          'probationary',
          'senior',
        ]);
      });

      it('reads as selected only once Senior is ticked too', async () => {
        render(
          <RequirementModal
            requirement={scoped(['active', 'probationary', 'life'])}
            categories={[]}
            onClose={vi.fn()}
            onSave={onSave}
          />
        );

        await screen.findByRole('checkbox', { name: 'Senior Member' });
        expect(screen.getByRole('button', { name: 'Operational members' })).toHaveAttribute('aria-pressed', 'false');
      });

      it('clears Senior with the rest when every operational type is ticked', async () => {
        const user = userEvent.setup();
        render(
          <RequirementModal
            requirement={scoped(['active', 'probationary', 'life', 'senior', 'honorary'])}
            categories={[]}
            onClose={vi.fn()}
            onSave={onSave}
          />
        );

        const shortcut = screen.getByRole('button', { name: 'Operational members' });
        await screen.findByRole('checkbox', { name: 'Senior Member' });
        expect(shortcut).toHaveAttribute('aria-pressed', 'true');
        await user.click(shortcut);

        await saveAsEveryone(user);
        const [payload] = onSave.mock.calls[0] as [{ required_membership_types: string[] }];
        expect(payload.required_membership_types).toEqual(['honorary']);
      });
    });

    it('fills in the missing types when only some are ticked', async () => {
      const user = userEvent.setup();
      render(
        <RequirementModal requirement={scoped(['active', 'life'])} categories={[]} onClose={vi.fn()} onSave={onSave} />
      );

      await user.click(screen.getByRole('button', { name: 'Operational members' }));

      await saveAsEveryone(user);
      const [payload] = onSave.mock.calls[0] as [{ required_membership_types: string[] }];
      expect([...payload.required_membership_types].sort()).toEqual(['active', 'life', 'probationary']);
    });

    it('reads as selected without Retired, and clears only the three it ticks', async () => {
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={scoped(['active', 'probationary', 'life', 'retired', 'honorary'])}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      const shortcut = screen.getByRole('button', { name: 'Operational members' });
      expect(shortcut).toHaveAttribute('aria-pressed', 'true');
      await user.click(shortcut);

      expect(shortcut).toHaveAttribute('aria-pressed', 'false');
      await saveAsEveryone(user);
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ applies_to_all: false, required_membership_types: ['retired', 'honorary'] }),
        true,
        'req-1'
      );
    });

    it('reads as selected for Active, Probationary and Life alone', () => {
      render(
        <RequirementModal
          requirement={scoped(['active', 'probationary', 'life'])}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );
      expect(screen.getByRole('button', { name: 'Operational members' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('checkbox', { name: 'Retired' })).not.toBeChecked();
    });

    it('is not offered while the requirement applies to all members', () => {
      render(<RequirementModal requirement={existing()} categories={[]} onClose={vi.fn()} onSave={onSave} />);
      expect(screen.queryByRole('button', { name: 'Operational members' })).not.toBeInTheDocument();
    });
  });

  describe('member categories', () => {
    const scoped = (types: string[]) => existing({ applies_to_all: false, required_membership_types: types });
    const departmentTiers = {
      membership_types: [
        { value: 'probationary', label: 'Probationary' },
        { value: 'active', label: 'Active Member' },
        { value: 'senior', label: 'Senior Member' },
        { value: 'life', label: 'Life Member' },
      ],
    };

    const saveAsEveryone = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));
    };

    beforeEach(() => {
      onSave.mockResolvedValue(undefined);
      getVisibleEventTypesWithCategories.mockResolvedValue(departmentTiers);
    });

    it("offers the department's own tiers, so senior members can be kept in while life members are left out", async () => {
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={scoped(['active', 'probationary'])}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      await user.click(await screen.findByRole('checkbox', { name: 'Senior Member' }));
      expect(screen.getByRole('checkbox', { name: 'Life' })).not.toBeChecked();

      await saveAsEveryone(user);
      const [payload] = onSave.mock.calls[0] as [{ required_membership_types: string[] }];
      expect([...payload.required_membership_types].sort()).toEqual(['active', 'probationary', 'senior']);
    });

    it('lists a built-in type once, under its built-in name, when a tier shares its id', async () => {
      render(<RequirementModal requirement={scoped(['active'])} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await screen.findByRole('checkbox', { name: 'Senior Member' });
      expect(screen.getAllByRole('checkbox', { name: 'Active' })).toHaveLength(1);
      expect(screen.queryByRole('checkbox', { name: 'Active Member' })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Life Member' })).not.toBeInTheDocument();
    });

    it('still shows a saved type when the tier list cannot be loaded, so it can be unticked', async () => {
      getVisibleEventTypesWithCategories.mockRejectedValue(new Error('offline'));
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={scoped(['active', 'senior'])}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      const senior = screen.getByRole('checkbox', { name: 'senior' });
      expect(senior).toBeChecked();
      await user.click(senior);

      await saveAsEveryone(user);
      const [payload] = onSave.mock.calls[0] as [{ required_membership_types: string[] }];
      expect(payload.required_membership_types).toEqual(['active']);
    });
  });

  describe('shift credit', () => {
    it('leaves a new hours requirement off the shift report unless ticked', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Annual Hazmat Hours');
      await user.type(screen.getByLabelText(/^Required Hours/), '6');
      expect(screen.getByRole('checkbox', { name: /Shift attendance satisfies/ })).not.toBeChecked();
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shift_credited: false }), false, undefined);
    });

    it('sends the flag an officer ticked on an existing hours requirement', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={existing({ shift_credited: false })}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      await user.click(screen.getByRole('checkbox', { name: /Shift attendance satisfies/ }));
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shift_credited: true }), true, 'req-1');
    });
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

    it('sends an explicit null when the training type is widened back to any type', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={existing({ training_type: 'continuing_education' })}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      await user.selectOptions(screen.getByLabelText('Training Type'), '');
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ apply_to: 'everyone', training_type: null }),
        true,
        'req-1'
      );
    });

    it('sends an empty category list when the last category is removed', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      const category: TrainingCategory = {
        id: 'cat-1',
        organization_id: 'org-1',
        name: 'Fire Suppression',
        sort_order: 0,
        active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
      render(
        <RequirementModal
          requirement={existing({ category_ids: ['cat-1'] })}
          categories={[category]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      await user.click(screen.getByRole('button', { name: /Fire Suppression/, pressed: true }));
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ category_ids: [] }), true, 'req-1');
    });

    it('sends an empty member category list when the last one is unchecked', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={existing({
            applies_to_all: false,
            required_membership_types: ['probationary'],
            required_roles: ['captain'],
          })}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      await user.click(screen.getByRole('checkbox', { name: 'Probationary' }));
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ applies_to_all: false, required_membership_types: [] }),
        true,
        'req-1'
      );
    });

    it('sends a null year when the year box is emptied', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <RequirementModal requirement={existing({ year: 2025 })} categories={[]} onClose={vi.fn()} onSave={onSave} />
      );

      await user.clear(screen.getByLabelText('Year'));
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ year: null }), true, 'req-1');
    });

    it('sends a null period end when it is set back to the end of the year', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={existing({ period_start_month: 3, period_end_month: 6, period_end_day: 30 })}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      await user.selectOptions(screen.getByLabelText(/Period End Month/), '');
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ period_end_month: null, period_end_day: null }),
        true,
        'req-1'
      );
    });

    it('sends a null due date when a fixed due date is cleared', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={existing({ due_date_type: 'fixed_date', due_date: '2026-12-31' })}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      await user.clear(screen.getByLabelText('Due Date'));
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ due_date: null }), true, 'req-1');
    });

    it('sends a null start date when the start date is cleared', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={existing({ start_date: '2026-01-01' })}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      await user.clear(screen.getByLabelText('Start Date'));
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ start_date: null }), true, 'req-1');
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

  it('can target policy acknowledgments, so an annual policy can be tracked', () => {
    render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

    expect(screen.getByRole('option', { name: 'Policy Acknowledgment' })).toHaveAttribute(
      'value',
      'policy_acknowledgment'
    );
  });

  describe('shift evaluation types', () => {
    it('creates an evaluated shifts requirement with its target and lowest-rating rule', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Evaluated field shifts');
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'evaluated_shifts');
      await user.type(screen.getByLabelText(/Required evaluated shifts/), '10');
      await user.click(screen.getByRole('checkbox', { name: /no item at the lowest rating/ }));
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          requirement_type: 'evaluated_shifts',
          required_shifts: 10,
          required_transports: null,
          required_refusals: null,
          evaluation_excludes_lowest_rating: true,
        }),
        false,
        undefined
      );
    });

    it('creates an evaluated calls requirement with its target in required_calls', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Evaluated field calls');
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'Evaluated Calls');
      await user.type(screen.getByLabelText(/Required evaluated calls/), '25');
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          requirement_type: 'evaluated_calls',
          required_calls: 25,
          required_call_types: [],
          required_transports: null,
          evaluation_excludes_lowest_rating: false,
        }),
        false,
        undefined
      );
    });

    it('will not create an evaluated calls requirement without a count', async () => {
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Evaluated field calls');
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'evaluated_calls');
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).not.toHaveBeenCalled();
    });

    it('will not create a transports requirement without a count', async () => {
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Transports');
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'transports');
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).not.toHaveBeenCalled();
    });

    it('clears the evaluation targets when the type is switched away', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={existing({ requirement_type: 'refusals', required_refusals: 5 })}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      expect(screen.getByLabelText(/Required refusals/)).toHaveValue(5);
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'hours');
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          requirement_type: 'hours',
          required_hours: 24,
          required_refusals: null,
          evaluation_excludes_lowest_rating: false,
        }),
        true,
        'req-1'
      );
    });
  });

  describe('session attendance', () => {
    it('creates one with its attendance percentage', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Company drills');
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'session_attendance');
      await user.type(screen.getByLabelText(/^Sessions to Attend/), '60');
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          requirement_type: 'session_attendance',
          required_attendance_pct: 60,
          required_hours: null,
        }),
        false,
        undefined
      );
    });

    it('does not offer the hours and training-type fields it never reads', async () => {
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      expect(screen.getByLabelText(/^Required Hours/)).toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'session_attendance');

      expect(screen.queryByLabelText(/^Required Hours/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^Training Type/)).not.toBeInTheDocument();
    });

    it('sends whether the Chief may override it, and clears it for another type', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Company drills');
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'session_attendance');
      await user.type(screen.getByLabelText(/^Sessions to Attend/), '60');
      await user.click(screen.getByRole('checkbox', { name: /Allow the Chief to override/ }));
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ requirement_type: 'session_attendance', allows_chief_override: true }),
        false,
        undefined
      );
    });

    it('will not create one without a percentage', async () => {
      const user = userEvent.setup();
      render(<RequirementModal requirement={null} categories={[]} onClose={vi.fn()} onSave={onSave} />);

      await user.type(screen.getByLabelText(/^Name/), 'Company drills');
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'session_attendance');
      await user.click(screen.getByRole('button', { name: 'Create Requirement' }));

      expect(onSave).not.toHaveBeenCalled();
    });

    it('clears the percentage when the type is switched away', async () => {
      onSave.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        <RequirementModal
          requirement={existing({ requirement_type: 'session_attendance', required_attendance_pct: 60 })}
          categories={[]}
          onClose={vi.fn()}
          onSave={onSave}
        />
      );

      expect(screen.getByLabelText(/^Sessions to Attend/)).toHaveValue(60);
      await user.selectOptions(screen.getByLabelText(/^Requirement Type/), 'hours');
      await user.click(screen.getByRole('button', { name: 'Update Requirement' }));
      await user.click(screen.getByRole('button', { name: 'Save for everyone' }));

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ requirement_type: 'hours', required_attendance_pct: null }),
        true,
        'req-1'
      );
    });
  });
});
