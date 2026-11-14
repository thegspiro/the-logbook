import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();
const mockRoles = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: { updateSettings: (...a: unknown[]) => mockUpdate(...a) as unknown },
  roleService: { getRoles: (...a: unknown[]) => mockRoles(...a) as unknown },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { SignerSettingsPanel } from './SignerSettingsPanel';
import type { MinutesReminderSettings } from '../types/minutes';

const defaults: MinutesReminderSettings = {
  action_item_reminders: true,
  reminder_days_before_due: 3,
  overdue_repeat_days: 7,
  open_items_digest: true,
  public_posting: false,
  executive_library_publishing: false,
  executive_public_posting: false,
  executive_effective_library: false,
  executive_effective_public: false,
  attendance_listing: 'all',
  auto_file_election_results: true,
  quorum_counts_late: true,
  quorum_counts_left_early: true,
  proxy_attendance: false,
  signature_slots: [
    { key: 'recording_secretary', title: 'Recording Secretary', position_slug: null },
    { key: 'presiding_officer', title: 'Presiding Officer', position_slug: null },
  ],
};

describe('SignerSettingsPanel', () => {
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onSaved.mockReset();
    onSaved.mockResolvedValue(undefined);
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    mockRoles.mockReset();
    mockRoles.mockResolvedValue([
      { slug: 'president', name: 'President' },
      { slug: 'secretary', name: 'Secretary' },
    ]);
  });

  const open = (settings: MinutesReminderSettings = defaults, canEdit = true) =>
    render(<SignerSettingsPanel settings={settings} canEdit={canEdit} onSaved={onSaved} />);

  it('shows the slots the server holds', async () => {
    open();
    expect(await screen.findByDisplayValue('Recording Secretary')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Presiding Officer')).toBeInTheDocument();
  });

  it('never replaces an input it has painted just because it mounted', () => {
    const removed: Node[] = [];
    const watcher = new MutationObserver((records) => {
      records.forEach((r) => removed.push(...Array.from(r.removedNodes)));
    });
    const host = document.body;
    watcher.observe(host, { childList: true, subtree: true });

    open();
    watcher.takeRecords().forEach((r) => removed.push(...Array.from(r.removedNodes)));
    watcher.disconnect();

    expect(removed.filter((n) => n.nodeName === 'LI')).toEqual([]);
  });

  it('lets a slot name a position, offering the department’s positions', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByDisplayValue('Presiding Officer');

    const who = screen.getAllByLabelText('May be signed by')[1] as HTMLElement;
    expect(
      within(who)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Anyone who manages minutes', 'President', 'Secretary']);
    await user.selectOptions(who, 'president');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      minutes: {
        signature_slots: [
          { key: 'recording_secretary', title: 'Recording Secretary', position_slug: null },
          { key: 'presiding_officer', title: 'Presiding Officer', position_slug: 'president' },
        ],
      },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('adds a signature with a key the server will accept, and keeps old keys when a slot is renamed', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByDisplayValue('Presiding Officer');

    const renamed = screen.getByDisplayValue('Presiding Officer');
    await user.clear(renamed);
    await user.type(renamed, 'Chair of the Board');
    await user.click(screen.getByRole('button', { name: 'Add a signature' }));
    await user.type(screen.getByLabelText(/^Signature 3/), '3rd Witness');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const sent = (mockUpdate.mock.calls[0]?.[0] as { minutes: { signature_slots: { key: string; title: string }[] } })
      .minutes.signature_slots;
    expect(sent.map((s) => [s.key, s.title])).toEqual([
      ['recording_secretary', 'Recording Secretary'],
      ['presiding_officer', 'Chair of the Board'],
      ['slot_3rd_witness', '3rd Witness'],
    ]);
  });

  it('removes and reorders signatures', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByDisplayValue('Presiding Officer');

    await user.click(screen.getByRole('button', { name: 'Move signature 2 up' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const order = (mockUpdate.mock.calls[0]?.[0] as { minutes: { signature_slots: { key: string }[] } }).minutes
      .signature_slots;
    expect(order.map((s) => s.key)).toEqual(['presiding_officer', 'recording_secretary']);
  });

  it('will not save with no signature or a blank title, and says so', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByDisplayValue('Presiding Officer');

    const second = screen.getByDisplayValue('Presiding Officer');
    await user.clear(second);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(second).toHaveAccessibleDescription('Give this signature a title.');

    await user.click(screen.getByRole('button', { name: 'Remove signature 2' }));
    await user.click(screen.getByRole('button', { name: 'Remove signature 1' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Not saved: adopted minutes need at least one signature.');
    expect(screen.getByText('Add at least one signature.')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('puts a 422 on the slot field it names and announces it', async () => {
    mockUpdate.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          detail: [{ field: 'minutes.signature_slots.1.title', message: 'String should have at most 100 characters' }],
        },
      },
    });
    const user = userEvent.setup();
    open();
    const second = await screen.findByDisplayValue('Presiding Officer');
    await user.type(second, ' of the Board');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(second).toHaveAccessibleDescription('Signature 2 is too long — keep it to 100 characters.')
    );
    expect(second).toHaveAttribute('aria-invalid', 'true');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('has nothing to save until something changes', async () => {
    open();

    await screen.findByDisplayValue('Recording Secretary');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('stops offering more at six', async () => {
    open({
      ...defaults,
      signature_slots: Array.from({ length: 6 }, (_, i) => ({ key: `s${i}`, title: `S${i}`, position_slug: null })),
    });
    await screen.findByDisplayValue('S5');
    expect(screen.queryByRole('button', { name: 'Add a signature' })).toBeNull();
  });

  it('is read-only for someone who cannot change organization settings', async () => {
    open(defaults, false);

    expect(await screen.findByDisplayValue('Recording Secretary')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a signature' })).toBeNull();
    expect(screen.getByText(/changed by a settings administrator/)).toBeInTheDocument();
  });

  it('still works when the positions cannot be listed', async () => {
    mockRoles.mockRejectedValue(new Error('403'));
    open({ ...defaults, signature_slots: [{ key: 'chair', title: 'Chair', position_slug: 'president' }] });

    const who = await screen.findByLabelText<HTMLSelectElement>('May be signed by');
    expect(who.value).toBe('president');
  });

  it('does not report a save that failed', async () => {
    mockUpdate.mockRejectedValue(new Error('Nope'));
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByLabelText(/^Signature 1/), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
