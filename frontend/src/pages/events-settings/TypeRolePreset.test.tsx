import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TypeRolePreset from './TypeRolePreset';

const ROLES = [
  { value: 'tour_guide', label: 'Tour Guide' },
  { value: 'greeter', label: 'Greeter' },
];

describe('TypeRolePreset', () => {
  const onSave = vi.fn();

  beforeEach(() => {
    onSave.mockReset();
    onSave.mockResolvedValue(true);
  });

  it('sets a preset for a type that has none', async () => {
    const user = userEvent.setup();
    render(
      <TypeRolePreset
        type={{ value: 'station_tour', label: 'Station Tour' }}
        roles={ROLES}
        saving={false}
        onSave={onSave}
      />
    );

    expect(screen.getByText('No role preset')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set the roles a Station Tour usually needs' }));
    const count = screen.getByRole('spinbutton', { name: 'How many for role 1' });
    await user.clear(count);
    await user.type(count, '2');
    await user.click(screen.getByRole('button', { name: 'Add a role' }));
    await user.click(screen.getByRole('button', { name: 'Save roles' }));

    expect(onSave).toHaveBeenCalledWith([
      { role: 'tour_guide', count: 2 },
      { role: 'greeter', count: 1 },
    ]);
  });

  it('shows a saved preset and clears it', async () => {
    const user = userEvent.setup();
    render(
      <TypeRolePreset
        type={{ value: 'station_tour', label: 'Station Tour', default_roles: [{ role: 'greeter', count: 3 }] }}
        roles={ROLES}
        saving={false}
        onSave={onSave}
      />
    );

    expect(screen.getByText('Usually needs 3 × Greeter')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit the roles a Station Tour usually needs' }));
    await user.click(screen.getByRole('button', { name: 'Clear preset' }));

    expect(onSave).toHaveBeenCalledWith([]);
  });

  it('refuses a preset larger than a signup sheet holds', async () => {
    const user = userEvent.setup();
    render(
      <TypeRolePreset
        type={{ value: 'fair', label: 'Fair', default_roles: [{ role: 'greeter', count: 50 }] }}
        roles={ROLES}
        saving={false}
        onSave={onSave}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Edit the roles a Fair usually needs' }));
    await user.click(screen.getByRole('button', { name: 'Add a role' }));

    expect(screen.getByText('A signup sheet holds at most 50 people.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save roles' })).toBeDisabled();
  });
});
