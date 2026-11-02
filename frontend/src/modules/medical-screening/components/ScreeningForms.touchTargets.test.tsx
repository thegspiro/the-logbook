/**
 * The requirement and record dialogs' Cancel and save buttons reach the 44px
 * touch minimum on a phone or touch screen.
 *
 * Deep-dive review 2026-11-02 measured both at 36px at 390x844: hand-rolled
 * class strings with no touch sizing, unlike the shared `btn-*` utilities.
 * jsdom has no layout, so this asserts the `touch:` variant that produces the
 * height (`(max-width: 767px), (pointer: coarse)`), and the review re-measured
 * it in a browser.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ScreeningSubjects } from '../types';

const listSubjects = vi.fn<() => Promise<ScreeningSubjects>>();
vi.mock('../services/api', () => ({
  medicalScreeningService: {
    listSubjects: () => listSubjects(),
  },
}));

import { ScreeningRecordForm } from './ScreeningRecordForm';
import { ScreeningRequirementForm } from './ScreeningRequirementForm';

describe('medical screening dialogs — footer touch targets', () => {
  beforeEach(() => {
    listSubjects.mockReset();
    listSubjects.mockResolvedValue({ members: [], prospects: [] });
  });

  it('sizes the record dialog buttons for touch', async () => {
    render(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Select a member');

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('touch:min-h-11');
    expect(screen.getByRole('button', { name: 'Add Record' })).toHaveClass('touch:min-h-11');
  });

  it('sizes the requirement dialog buttons for touch', () => {
    render(<ScreeningRequirementForm requirement={null} onSave={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('touch:min-h-11');
    expect(screen.getByRole('button', { name: 'Add Requirement' })).toHaveClass('touch:min-h-11');
  });
});
