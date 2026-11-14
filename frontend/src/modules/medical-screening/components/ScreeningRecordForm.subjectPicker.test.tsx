/**
 * MS-13: the Add Record dialog files a record against exactly one member or
 * one prospect.
 *
 * Before this the dialog had no control for either id, so every record it
 * created belonged to nobody and counted toward no one's compliance. The
 * owner's decision was a picker with exactly one of the two — the API now
 * rejects neither and both — so these tests pin that the payload carries the
 * chosen subject and only that one, and that the dialog cannot submit until a
 * subject is chosen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import userEvent from '@testing-library/user-event';
import type { ScreeningRecord, ScreeningSubjects } from '../types';

const listSubjects = vi.fn<() => Promise<ScreeningSubjects>>();
vi.mock('../services/api', () => ({
  medicalScreeningService: {
    listSubjects: () => listSubjects(),
  },
}));

import { ScreeningRecordForm } from './ScreeningRecordForm';

const subjects: ScreeningSubjects = {
  members: [
    { id: 'u-1', name: 'Jake Thompson' },
    { id: 'u-2', name: 'Maria Lopez' },
  ],
  prospects: [{ id: 'p-1', name: 'Alex Rivera' }],
};

const baseRecord: ScreeningRecord = {
  id: 'rec-1',
  organization_id: 'org-1',
  user_id: 'u-1',
  screening_type: 'physical_exam',
  status: 'passed',
  self_recorded: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-05T00:00:00Z',
};

const subjectSelect = () => screen.getByRole('combobox', { name: /member|prospect/i });

describe('ScreeningRecordForm — subject picker (MS-13)', () => {
  beforeEach(() => {
    listSubjects.mockReset();
    listSubjects.mockResolvedValue(structuredClone(subjects));
  });

  it('files the record against the chosen member only', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ScreeningRecordForm record={null} requirements={[]} onSave={onSave} onClose={vi.fn()} />);

    await screen.findByRole('option', { name: 'Maria Lopez' }, { timeout: 5000 });
    await user.selectOptions(subjectSelect(), 'u-2');
    await user.click(screen.getByRole('button', { name: 'Add Record' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.user_id).toBe('u-2');
    expect(payload.prospect_id).toBeUndefined();
  });

  it('files the record against the chosen prospect only', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ScreeningRecordForm record={null} requirements={[]} onSave={onSave} onClose={vi.fn()} />);

    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    await user.click(screen.getByRole('radio', { name: 'Prospect' }));
    // Switching lists offers only prospects and drops the member choice.
    expect(within(subjectSelect()).queryByRole('option', { name: 'Jake Thompson' })).not.toBeInTheDocument();
    await user.selectOptions(subjectSelect(), 'p-1');
    await user.click(screen.getByRole('button', { name: 'Add Record' }));

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.prospect_id).toBe('p-1');
    expect(payload.user_id).toBeUndefined();
  });

  it('switching kind clears a choice made in the other list', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);

    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    await user.selectOptions(subjectSelect(), 'u-1');
    await user.click(screen.getByRole('radio', { name: 'Prospect' }));

    expect(subjectSelect()).toHaveValue('');
  });

  // The button used to stay disabled until a subject was chosen, which told
  // an officer nothing; it now says why on the field (forms review F-3).
  it('cannot be submitted before a subject is chosen, and says so on the field', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithRouter(<ScreeningRecordForm record={null} requirements={[]} onSave={onSave} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: 'Add Record' }));

    expect(subjectSelect()).toHaveAttribute('aria-invalid', 'true');
    expect(subjectSelect()).toHaveAccessibleDescription('Choose the member this record is for.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('puts a server refusal on its field and creates nothing more', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ field: 'provider_name', message: 'String should have at most 255 characters' }] },
      },
    });
    renderWithRouter(<ScreeningRecordForm record={null} requirements={[]} onSave={onSave} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    await user.selectOptions(subjectSelect(), 'u-1');
    await user.type(screen.getByLabelText('Provider / Facility'), 'Valley Medical{Enter}');

    const provider = screen.getByLabelText('Provider / Facility');
    expect(await screen.findByText(/Provider \/ facility is too long/)).toBeInTheDocument();
    expect(provider).toHaveAttribute('aria-invalid', 'true');
    expect(provider).toHaveAccessibleDescription('Provider / facility is too long — keep it to 255 characters.');
    expect(screen.queryByText(/provider_name/)).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('asks before Escape discards what was entered', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRouter(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={onClose} />);
    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    await user.selectOptions(subjectSelect(), 'u-1');
    await user.keyboard('{Escape}');

    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(subjectSelect()).toHaveValue('u-1');
  });

  it('on edit, saves the rest without a refused field and keeps the dialog open with it flagged', async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn()
      .mockRejectedValueOnce({
        response: { status: 422, data: { detail: [{ field: 'completed_date', message: 'Invalid date format.' }] } },
      })
      .mockResolvedValue(undefined);
    renderWithRouter(<ScreeningRecordForm record={baseRecord} requirements={[]} onSave={onSave} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    const completed = screen.getByLabelText('Completed Date');
    await vi.waitFor(() => expect(completed).toHaveAccessibleDescription('Completed date needs a valid date.'));
    expect(onSave).toHaveBeenCalledTimes(2);
    const retried = onSave.mock.calls[1] as [Record<string, unknown>, { keepOpen?: boolean }];
    expect('completed_date' in retried[0]).toBe(false);
    expect(retried[0].status).toBe('passed');
    expect(retried[1]).toEqual({ keepOpen: true });
    expect(screen.getByRole('status')).toHaveTextContent(/Saved, except the field flagged below/);
  });

  it('says so when the list cannot be loaded', async () => {
    listSubjects.mockReset();
    listSubjects.mockRejectedValue(new Error('Network down'));
    renderWithRouter(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent('Network down');
    expect(screen.getByRole('button', { name: 'Add Record' })).toBeDisabled();
  });

  it('no longer carries the "not linked" notice', async () => {
    renderWithRouter(<ScreeningRecordForm record={null} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole('option', { name: 'Jake Thompson' }, { timeout: 5000 });
    expect(screen.queryByText(/not linked to a member or prospect/i)).not.toBeInTheDocument();
  });

  it('the edit dialog shows no picker and loads no list', () => {
    renderWithRouter(<ScreeningRecordForm record={baseRecord} requirements={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('radio', { name: 'Member' })).not.toBeInTheDocument();
    expect(listSubjects).not.toHaveBeenCalled();
  });
});
