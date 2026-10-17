import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import PatternFormModal from './PatternFormModal';
import { emptyPatternForm } from './shiftTemplateTypes';
import type { PatternFormData, ShiftTemplate } from './shiftTemplateTypes';

const templates = [
  { id: 'tpl-1', name: 'Day Shift', start_time_of_day: '08:00', end_time_of_day: '20:00' },
] as ShiftTemplate[];

const storedPattern: PatternFormData = {
  ...emptyPatternForm,
  name: '24/48 Rotation',
  description: 'A/B/C platoons',
  pattern_type: 'platoon',
  template_id: 'tpl-1',
  rotation_days: '3',
  days_on: '1',
  days_off: '2',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
};

describe('PatternFormModal payload', () => {
  const onSubmit = vi.fn<(data: Record<string, unknown>) => Promise<void>>();

  // Reset before installing the default, so no override leaks between tests
  // (CLAUDE.md pitfall #28).
  beforeEach(() => {
    onSubmit.mockReset();
    onSubmit.mockResolvedValue(undefined);
  });

  it('sends null for every cleared optional field when editing, so the clear persists', async () => {
    // The update endpoint reads exclude_unset: an omitted key keeps the stored
    // value, so "No template" or an emptied end date snapped back after save.
    const user = userEvent.setup();
    renderWithRouter(
      <PatternFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initialData={storedPattern}
        title="Edit Pattern"
        templates={templates}
      />
    );

    await user.clear(screen.getByLabelText('Description'));
    await user.selectOptions(screen.getByLabelText('Shift Template'), '');
    await user.clear(screen.getByLabelText('Rotation Days'));
    await user.clear(screen.getByLabelText('Days On'));
    await user.clear(screen.getByLabelText('Days Off'));
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Save Pattern' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      name: '24/48 Rotation',
      pattern_type: 'platoon',
      start_date: '2026-01-01',
      description: null,
      template_id: null,
      rotation_days: null,
      days_on: null,
      days_off: null,
      end_date: null,
    });
  });

  it('sends the values unchanged when editing without clearing anything', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <PatternFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initialData={storedPattern}
        title="Edit Pattern"
        templates={templates}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Save Pattern' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        description: 'A/B/C platoons',
        template_id: 'tpl-1',
        rotation_days: 3,
        days_on: 1,
        days_off: 2,
        end_date: '2026-12-31',
      })
    );
  });

  it('omits blank optional fields when creating', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <PatternFormModal isOpen onClose={vi.fn()} onSubmit={onSubmit} title="Create Pattern" templates={templates} />
    );

    await user.type(screen.getByLabelText(/^Name/), 'Daily Days');
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: '2026-02-01' } });
    await user.click(screen.getByRole('button', { name: 'Save Pattern' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]?.[0] ?? {};
    for (const key of ['description', 'template_id', 'rotation_days', 'days_on', 'days_off', 'end_date']) {
      expect(payload[key]).toBeUndefined();
    }
  });

  it('offers no weekly or custom type for a new pattern, and points to the Patterns tab', () => {
    // This form has no weekday or date fields, so a weekly or custom pattern
    // saved from it carried no schedule_config and generated no shifts.
    renderWithRouter(
      <PatternFormModal isOpen onClose={vi.fn()} onSubmit={onSubmit} title="Create Pattern" templates={templates} />
    );

    const values = Array.from(
      screen.getByLabelText<HTMLSelectElement>(/^Pattern Type/).options,
      (option) => option.value
    );
    expect(values).toEqual(['daily', 'platoon']);
    expect(screen.getByRole('link', { name: 'Patterns tab' })).toHaveAttribute(
      'href',
      '/scheduling/admin/planning/patterns'
    );
  });

  it('keeps a stored weekly pattern weekly when it is edited here', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <PatternFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initialData={{ ...storedPattern, pattern_type: 'weekly' }}
        title="Edit Pattern"
        templates={templates}
      />
    );

    const select = screen.getByLabelText<HTMLSelectElement>(/^Pattern Type/);
    expect(select.value).toBe('weekly');
    expect(Array.from(select.options, (option) => option.value)).toEqual(['daily', 'weekly', 'platoon']);

    await user.click(screen.getByRole('button', { name: 'Save Pattern' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ pattern_type: 'weekly' }));
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('schedule_config');
  });
});
