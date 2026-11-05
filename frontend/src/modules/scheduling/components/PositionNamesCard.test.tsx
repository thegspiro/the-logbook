import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DEFAULT_SETTINGS } from '../types/shiftSettings';
import type { ShiftSettings } from '../types/shiftSettings';
import { PositionNamesCard } from './PositionNamesCard';

describe('PositionNamesCard', () => {
  it('names the custom position field and adds what is typed into it', async () => {
    const onSettingsChange = vi.fn<(updater: (prev: ShiftSettings) => ShiftSettings) => void>();
    const user = userEvent.setup();
    render(
      <PositionNamesCard settings={DEFAULT_SETTINGS} onSettingsChange={onSettingsChange} allPositionOptions={[]} />
    );

    await user.type(screen.getByRole('textbox', { name: 'Custom position name' }), 'Tillerman');
    await user.click(screen.getByRole('button', { name: 'Add Position' }));

    const { calls } = onSettingsChange.mock;
    const updater = calls[calls.length - 1]?.[0];
    expect(updater?.(DEFAULT_SETTINGS).customPositions).toContainEqual({ value: 'tillerman', label: 'Tillerman' });
  });

  it('marks a custom seat as driving the apparatus', async () => {
    const settings: ShiftSettings = {
      ...DEFAULT_SETTINGS,
      customPositions: [{ value: 'engineer', label: 'Engineer' }],
    };
    const onSettingsChange = vi.fn<(updater: (prev: ShiftSettings) => ShiftSettings) => void>();
    const user = userEvent.setup();
    render(<PositionNamesCard settings={settings} onSettingsChange={onSettingsChange} allPositionOptions={[]} />);

    const box = screen.getByRole('checkbox', { name: 'Engineer drives apparatus' });
    expect(box).not.toBeChecked();
    await user.click(box);

    const updater = onSettingsChange.mock.calls[0]?.[0];
    expect(updater?.(settings).customPositions).toEqual([
      { value: 'engineer', label: 'Engineer', drivesApparatus: true },
    ]);
  });

  it('maps a certification to a custom seat, and unmaps it', async () => {
    // SCHED-CUSTOM-SEAT owner decision (2026-11-01): a certification may
    // confer one of the department's own seats; the mapping is saved on the
    // seat's own entry, which the server reads in every eligibility answer.
    const settings: ShiftSettings = {
      ...DEFAULT_SETTINGS,
      customPositions: [
        { value: 'swiftwater', label: 'Swiftwater Rescuer', qualifications: ['paramedic'] },
        { value: 'rope_team', label: 'Rope Team' },
      ],
    };
    const onSettingsChange = vi.fn<(updater: (prev: ShiftSettings) => ShiftSettings) => void>();
    const user = userEvent.setup();
    render(<PositionNamesCard settings={settings} onSettingsChange={onSettingsChange} allPositionOptions={[]} />);

    expect(screen.getByRole('checkbox', { name: 'Paramedic qualifies for Swiftwater Rescuer' })).toBeChecked();
    const emt = screen.getByRole('checkbox', { name: 'EMT qualifies for Swiftwater Rescuer' });
    expect(emt).not.toBeChecked();
    await user.click(emt);
    await user.click(screen.getByRole('checkbox', { name: 'Paramedic qualifies for Swiftwater Rescuer' }));

    const [added, removed] = onSettingsChange.mock.calls.map((call) => call[0]);
    expect(added?.(settings).customPositions).toEqual([
      { value: 'swiftwater', label: 'Swiftwater Rescuer', qualifications: ['paramedic', 'emt'] },
      { value: 'rope_team', label: 'Rope Team' },
    ]);
    expect(removed?.(settings).customPositions[0]).toEqual({
      value: 'swiftwater',
      label: 'Swiftwater Rescuer',
      qualifications: [],
    });
  });

  it('labels the position ticks as not in effect yet', () => {
    // Nothing reads `enabledPositions`: the template and shift pickers offer a
    // fixed list. A tick that changes nothing must say so (CLAUDE.md #19).
    render(<PositionNamesCard settings={DEFAULT_SETTINGS} onSettingsChange={vi.fn()} allPositionOptions={[]} />);
    expect(screen.getByRole('note')).toHaveTextContent(/Not in effect yet/);
  });
});
