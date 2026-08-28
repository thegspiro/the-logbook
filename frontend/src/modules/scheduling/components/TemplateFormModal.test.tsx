import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import TemplateFormModal from './TemplateFormModal';
import { emptyTemplateForm } from './shiftTemplateTypes';

describe('TemplateFormModal administrative position access', () => {
  it('edits, displays, and saves the per-position option', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
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
});
