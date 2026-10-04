import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getFeatureSettings: () =>
      Promise.resolve({
        call_tracking: {
          mode: 'count_only',
          call_types: [
            { slug: 'fire', label: 'Fire', active: true },
            { slug: 'mva', label: 'Motor Vehicle Accident', active: true },
          ],
        },
      }),
  },
}));

import { CallTypeRequirementPicker } from './CallTypeRequirementPicker';

describe('CallTypeRequirementPicker', () => {
  it("offers the department's types and stores slugs, so a rename cannot break it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<CallTypeRequirementPicker value={[]} onChange={onChange} />);

    await user.click(await screen.findByRole('button', { name: 'Motor Vehicle Accident' }));
    expect(onChange).toHaveBeenCalledWith(['mva']);
    expect(screen.getByText(/every call counts/)).toBeInTheDocument();
  });

  it('keeps a value typed before the picker existed so it can be removed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<CallTypeRequirementPicker value={['fire', 'Structure Fire']} onChange={onChange} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Fire' })).toHaveAttribute('aria-pressed', 'true'));
    const legacy = screen.getByRole('button', { name: 'Structure Fire' });
    expect(legacy).toHaveAttribute('aria-pressed', 'true');
    await user.click(legacy);
    expect(onChange).toHaveBeenCalledWith(['fire']);
    expect(screen.getByText(/Only calls of the selected types count/)).toBeInTheDocument();
  });
});
