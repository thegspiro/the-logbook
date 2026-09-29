import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../hooks/useCourseLibrary', () => ({
  useCourseLibrary: () => ({ courses: [], loading: false, error: null }),
}));

import { RequirementModal } from './RequirementModal';

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
});
