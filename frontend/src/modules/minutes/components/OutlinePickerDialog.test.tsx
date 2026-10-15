import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockOutlines = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: { getOutlines: (...a: unknown[]) => mockOutlines(...a) as unknown },
}));

import { OutlinePickerDialog } from './OutlinePickerDialog';
import { renderWithRouter } from '../../../test/utils';

const outlines = [
  {
    id: 'o1',
    name: 'Standard Business Meeting',
    meeting_type: 'business',
    is_default: true,
    section_count: 11,
    created_at: '',
  },
  { id: 'o2', name: 'Short form', meeting_type: 'business', is_default: false, section_count: 4, created_at: '' },
  { id: 'o3', name: 'Special Meeting', meeting_type: 'special', is_default: true, section_count: 5, created_at: '' },
];

describe('OutlinePickerDialog', () => {
  const onChoose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOutlines.mockReset();
    mockOutlines.mockResolvedValue(outlines);
  });

  const open = (meetingType: string, extra = {}) =>
    renderWithRouter(
      <OutlinePickerDialog
        isOpen
        meetingType={meetingType}
        busy={false}
        onClose={vi.fn()}
        onChoose={onChoose}
        {...extra}
      />
    );

  it('preselects the default outline for that kind of meeting', async () => {
    open('business');
    expect(await screen.findByLabelText('Outline')).toHaveValue('o1');
    expect(
      screen.getByRole('option', { name: /Standard Business Meeting \(default\) — 11 sections/ })
    ).toBeInTheDocument();
  });

  it('preselects the default for a different kind', async () => {
    open('special');
    expect(await screen.findByLabelText('Outline')).toHaveValue('o3');
  });

  it('falls back to the first outline when none is of that kind', async () => {
    open('annual');
    expect(await screen.findByLabelText('Outline')).toHaveValue('o1');
  });

  it('hands back the chosen outline', async () => {
    const user = userEvent.setup();
    open('business');

    await user.selectOptions(await screen.findByLabelText('Outline'), 'o2');
    await user.click(screen.getByRole('button', { name: 'Create minutes' }));

    expect(onChoose).toHaveBeenCalledWith('o2');
  });

  it('can be worded for applying an outline to a draft', async () => {
    open('business', {
      title: 'Apply an outline',
      confirmLabel: 'Apply outline',
      intro: 'Everything you wrote is kept.',
    });
    expect(await screen.findByRole('button', { name: 'Apply outline' })).toBeInTheDocument();
    expect(screen.getByText('Everything you wrote is kept.')).toBeInTheDocument();
  });

  it('reports a load failure instead of an empty picker', async () => {
    mockOutlines.mockRejectedValue(new Error('boom'));
    open('business');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create minutes' })).toBeDisabled();
  });
});
