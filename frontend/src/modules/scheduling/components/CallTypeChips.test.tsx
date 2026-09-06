import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CallTypeChips, orgCallTypeChoices, textCallTypeChoices } from './CallTypeChips';
import type { CallTypeOption } from '../types';

const type = (slug: string, label: string, active = true): CallTypeOption => ({ slug, label, active });

describe('orgCallTypeChoices', () => {
  it('offers the department name and stores the slug', () => {
    expect(orgCallTypeChoices([type('mutual_aid', 'Mutual Aid')], [])).toEqual([
      { value: 'mutual_aid', label: 'Mutual Aid' },
    ]);
  });

  it('keeps the department order', () => {
    const choices = orgCallTypeChoices([type('b', 'Second'), type('a', 'First')], []);

    expect(choices.map((c) => c.value)).toEqual(['b', 'a']);
  });

  it('omits a retired type nothing on this report uses', () => {
    const choices = orgCallTypeChoices([type('fire', 'Fire'), type('brush', 'Brush', false)], []);

    expect(choices.map((c) => c.value)).toEqual(['fire']);
  });

  it('offers a retired type the report already names, so it can be removed', () => {
    const choices = orgCallTypeChoices([type('fire', 'Fire'), type('brush', 'Brush', false)], ['brush']);

    expect(choices).toEqual([
      { value: 'fire', label: 'Fire' },
      { value: 'brush', label: 'Brush' },
    ]);
  });

  it('offers a stored value the department no longer configures at all', () => {
    // No label survives for it, but a chip nobody can see is one an officer
    // cannot remove — and saving without it would drop the value silently.
    const choices = orgCallTypeChoices([type('fire', 'Fire')], ['gone_long_ago']);

    expect(choices).toEqual([
      { value: 'fire', label: 'Fire' },
      { value: 'gone_long_ago', label: 'gone_long_ago' },
    ]);
  });

  it('does not duplicate a stored value that is still configured', () => {
    const choices = orgCallTypeChoices([type('fire', 'Fire')], ['fire']);

    expect(choices).toEqual([{ value: 'fire', label: 'Fire' }]);
  });
});

describe('textCallTypeChoices', () => {
  it('stores exactly what it shows', () => {
    expect(textCallTypeChoices(['Structure Fire'])).toEqual([{ value: 'Structure Fire', label: 'Structure Fire' }]);
  });
});

describe('CallTypeChips', () => {
  const onToggle = vi.fn();

  beforeEach(() => {
    onToggle.mockReset();
  });

  it('marks a stored slug as selected while showing its label', () => {
    render(
      <CallTypeChips
        choices={[{ value: 'mutual_aid', label: 'Mutual Aid' }]}
        selected={['mutual_aid']}
        onToggle={onToggle}
      />
    );

    expect(screen.getByRole('button', { name: 'Mutual Aid' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles the value, not the label', async () => {
    const user = userEvent.setup();
    render(
      <CallTypeChips choices={[{ value: 'mutual_aid', label: 'Mutual Aid' }]} selected={[]} onToggle={onToggle} />
    );

    await user.click(screen.getByRole('button', { name: 'Mutual Aid' }));

    expect(onToggle).toHaveBeenCalledWith('mutual_aid');
  });

  it('leaves an unselected chip unpressed', () => {
    render(
      <CallTypeChips choices={[{ value: 'fire', label: 'Fire' }]} selected={['mutual_aid']} onToggle={onToggle} />
    );

    expect(screen.getByRole('button', { name: 'Fire' })).toHaveAttribute('aria-pressed', 'false');
  });
});
