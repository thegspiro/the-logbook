import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import TemplateFormModal from './TemplateFormModal';
import { emptyTemplateForm } from './shiftTemplateTypes';

describe('TemplateFormModal administrative position access', () => {
  it('edits, displays, and saves the per-position option', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined);
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{
          ...emptyTemplateForm,
          name: 'Support shift',
          positions: [{ position: 'other', required: true, allow_administrative_members: false }],
        }}
      />
    );

    expect(screen.getByText(/Administrative members can only use positions/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Administrative access' }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        positions: [expect.objectContaining({ position: 'other', allow_administrative_members: true })],
      })
    );
  });

  it('preserves administrative access on event resource seats', async () => {
    const user = userEvent.setup();
    let submitted: Record<string, unknown> | undefined;
    const onSubmit = vi.fn(async (data: Record<string, unknown>) => {
      submitted = data;
    });
    renderWithRouter(
      <TemplateFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        title="Edit event template"
        apparatusOptions={[]}
        apparatusSource="default"
        initialData={{
          ...emptyTemplateForm,
          name: 'Community event',
          category: 'event',
          resources: [{ type: 'utility_vehicle', label: 'Support', quantity: 1, positions: ['other'] }],
        }}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: 'Allow administrative members for other' }));
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(submitted?.positions).toEqual(
      expect.objectContaining({
        resources: [
          expect.objectContaining({
            positions: [expect.objectContaining({ position: 'other', allow_administrative_members: true })],
          }),
        ],
        flat_positions: [expect.objectContaining({ position: 'other', allow_administrative_members: true })],
      })
    );
  });
});
