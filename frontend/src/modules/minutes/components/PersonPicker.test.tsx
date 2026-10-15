import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonPicker } from './PersonPicker';
import { motionMakers } from '../utils/motionMakers';
import type { AttendeeEntry } from '../types/minutes';

const roll: AttendeeEntry[] = [
  { name: 'Pat Chief', status: 'present', present: true },
  { name: 'Lee Treasurer', status: 'late', present: true },
  { name: 'Max Early', status: 'left_early', present: true },
  { name: 'Sam Excused', status: 'excused', present: false },
  { name: 'Sam Absent', status: 'absent', present: false },
  { name: 'A visitor', status: 'guest', present: false },
  { name: 'Old Row', present: true },
  { name: 'Gone Row', present: false },
  { name: 'Pat Chief', status: 'present', present: true },
];

describe('motionMakers', () => {
  it('lists those who were in the room, once each, and nobody else', () => {
    expect(motionMakers(roll)).toEqual(['Pat Chief', 'Lee Treasurer', 'Max Early', 'Old Row']);
  });
});

describe('PersonPicker', () => {
  const setup = (value = '', exclude?: string) => {
    const onChange = vi.fn();
    render(
      <PersonPicker id="who" label="Moved by" value={value} onChange={onChange} attendees={roll} exclude={exclude} />
    );
    return onChange;
  };

  it('offers the roll and a way to type a name', () => {
    setup();
    const names = within(screen.getByLabelText('Moved by'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual([
      'Choose from the roll…',
      'Pat Chief',
      'Lee Treasurer',
      'Max Early',
      'Old Row',
      'Someone else (type a name)',
    ]);
  });

  it('reports the member chosen', async () => {
    const onChange = setup();
    await userEvent.setup().selectOptions(screen.getByLabelText('Moved by'), 'Lee Treasurer');
    expect(onChange).toHaveBeenCalledWith('Lee Treasurer');
  });

  it('leaves out the excluded name', () => {
    setup('', 'Pat Chief');
    expect(within(screen.getByLabelText('Moved by')).queryByRole('option', { name: 'Pat Chief' })).toBeNull();
  });

  it('clears the value and shows a text box when someone else is chosen', async () => {
    const onChange = setup('Pat Chief');
    expect(screen.queryByLabelText('Moved by, typed name')).toBeNull();

    await userEvent.setup().selectOptions(screen.getByLabelText('Moved by'), 'Someone else (type a name)');

    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByLabelText('Moved by, typed name')).toBeInTheDocument();
  });

  it('opens in typing mode for a name that is not on the roll', () => {
    setup('Chief Emeritus Alvarez');
    expect(screen.getByLabelText('Moved by')).toHaveValue('__someone_else__');
    expect(screen.getByLabelText('Moved by, typed name')).toHaveValue('Chief Emeritus Alvarez');
  });

  it('limits a typed name to what a motion can store', () => {
    setup('Someone');
    expect(screen.getByLabelText('Moved by, typed name')).toHaveAttribute('maxLength', '200');
  });

  it('says so when no one is recorded as present', () => {
    render(<PersonPicker id="who" label="Moved by" value="" onChange={vi.fn()} attendees={[]} />);
    expect(screen.getByText(/No one is recorded as present yet/)).toBeInTheDocument();
  });
});
