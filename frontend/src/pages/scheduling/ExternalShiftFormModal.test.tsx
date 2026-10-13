import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockGetOptions = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getExternalApparatusOptions: (...args: unknown[]) => mockGetOptions(...args) as unknown,
    logExternalShift: vi.fn(),
    updateExternalShift: vi.fn(),
  },
}));

import { ExternalShiftFormModal } from './ExternalShiftFormModal';

describe('ExternalShiftFormModal', () => {
  beforeEach(() => {
    mockGetOptions.mockReset();
    mockGetOptions.mockResolvedValue({ agencies: [] });
  });

  it('keeps Log shift and Cancel in the pinned footer, outside the scrolling fields', async () => {
    const onClose = vi.fn();
    renderWithRouter(<ExternalShiftFormModal isOpen onClose={onClose} onSaved={vi.fn()} />);

    expect(screen.getByTestId('modal-panel').tagName).toBe('FORM');
    const footer = screen.getByTestId('modal-footer');
    expect(within(footer).getByRole('button', { name: 'Log shift' })).toHaveAttribute('type', 'submit');

    await userEvent.setup().click(within(footer).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
