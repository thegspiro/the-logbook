import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../services/api', () => ({
  roleService: { getRoles: () => Promise.resolve([{ id: 'r-1', name: 'Firefighter' }]) },
}));

import TargetRolePicker from './TargetRolePicker';

describe('TargetRolePicker', () => {
  it('announces a refusal on the select, alongside its hint', async () => {
    render(
      <TargetRolePicker
        id="pick"
        value=""
        onChange={vi.fn()}
        hint="Applied on conversion."
        error="That position is not in this department."
      />
    );
    const select = await screen.findByRole('combobox', { name: 'Target Role' });
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAccessibleDescription('That position is not in this department. Applied on conversion.');
  });

  it('is not marked invalid without an error', async () => {
    render(<TargetRolePicker value="" onChange={vi.fn()} />);
    expect(await screen.findByRole('combobox', { name: 'Target Role' })).not.toHaveAttribute('aria-invalid');
  });
});
