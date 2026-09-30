/**
 * The pipeline's conversion rule: what operational and administrative
 * applicants become as members.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Pipeline } from '../types';

const mockUpdatePipeline = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../services/api', () => ({
  pipelineService: {
    updatePipeline: (...args: unknown[]) => mockUpdatePipeline(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

import { ConversionOutcomesCard } from './ConversionOutcomesCard';

const pipeline = {
  id: 'pipe-1',
  conversion_config: {
    operational: { member_class: 'operational', member_status: 'probationary' },
    administrative: { member_class: 'administrative', member_status: 'regular' },
  },
} as unknown as Pipeline;

describe('ConversionOutcomesCard', () => {
  beforeEach(() => {
    mockUpdatePipeline.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  it("shows the pipeline's outcome for each applicant track", () => {
    render(<ConversionOutcomesCard pipeline={pipeline} onSaved={vi.fn()} />);

    const classes = screen.getAllByRole('combobox', { name: 'Member class' });
    const statuses = screen.getAllByRole('combobox', { name: 'Starting status' });
    expect(classes.map((c) => (c as HTMLSelectElement).value)).toEqual(['operational', 'administrative']);
    expect(statuses.map((c) => (c as HTMLSelectElement).value)).toEqual(['probationary', 'regular']);
  });

  it('saves the whole rule, as a department changes it', async () => {
    // The example the setting exists for: administrative applicants become
    // probationary administrative members.
    const saved = { ...pipeline };
    mockUpdatePipeline.mockResolvedValue(saved);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<ConversionOutcomesCard pipeline={pipeline} onSaved={onSaved} />);

    const adminStatus = screen.getAllByRole('combobox', { name: 'Starting status' })[1] as HTMLElement;
    await user.selectOptions(adminStatus, 'probationary');
    await user.click(screen.getByRole('button', { name: /save conversion settings/i }));

    await waitFor(() =>
      expect(mockUpdatePipeline).toHaveBeenCalledWith('pipe-1', {
        conversion_config: {
          operational: { member_class: 'operational', member_status: 'probationary' },
          administrative: { member_class: 'administrative', member_status: 'probationary' },
        },
      })
    );
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(mockToastSuccess).toHaveBeenCalledWith('Conversion settings saved');
  });

  it('reports a failed save', async () => {
    mockUpdatePipeline.mockRejectedValue(new Error('Server said no'));
    const user = userEvent.setup();
    render(<ConversionOutcomesCard pipeline={pipeline} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /save conversion settings/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Server said no'));
  });
});
