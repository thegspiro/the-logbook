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
});
