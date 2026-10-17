import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/api', () => ({
  documentsService: { getDocuments: vi.fn() },
}));

import { AgendaItemsEditor } from './AgendaItemsEditor';
import type { AgendaItem } from '../../../services/api';

const item = (key: string, title: string, extra: Partial<AgendaItem> = {}): AgendaItem => ({
  key,
  title,
  presenter: '',
  notes: '',
  needs_motion: false,
  motion_text: '',
  documents: [],
  ...extra,
});

describe('AgendaItemsEditor', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    onChange.mockReset();
  });

  const open = (items: AgendaItem[], disabled = false) =>
    render(<AgendaItemsEditor idPrefix="t" items={items} onChange={onChange} disabled={disabled} />);

  it('says what an empty agenda means', () => {
    open([]);
    expect(screen.getByText(/start from your outline instead/)).toBeInTheDocument();
  });

  it('adds an item with a fresh key the server accepts', async () => {
    const user = userEvent.setup();
    open([item('a', 'One')]);
    await user.click(screen.getByRole('button', { name: 'Add an item' }));

    const next = onChange.mock.calls[0]?.[0] as AgendaItem[];
    expect(next).toHaveLength(2);
    expect(next[1]?.key).toMatch(/^[a-z0-9][a-z0-9_-]{0,49}$/);
    expect(next[1]?.key).not.toBe('a');
    expect(next[1]?.title).toBe('');
  });

  it('keeps an item’s key when its title is edited', async () => {
    const user = userEvent.setup();
    open([item('a', 'One')]);
    await user.type(screen.getByLabelText('Item 1'), '!');

    const next = onChange.mock.calls[0]?.[0] as AgendaItem[];
    expect(next[0]).toMatchObject({ key: 'a', title: 'One!' });
  });

  it('reorders and removes', async () => {
    const user = userEvent.setup();
    open([item('a', 'One'), item('b', 'Two')]);

    await user.click(screen.getByRole('button', { name: 'Move item 2 up' }));
    expect((onChange.mock.calls[0]?.[0] as AgendaItem[]).map((i) => i.key)).toEqual(['b', 'a']);

    await user.click(screen.getByRole('button', { name: 'Remove item 1' }));
    expect((onChange.mock.calls[1]?.[0] as AgendaItem[]).map((i) => i.key)).toEqual(['b']);
  });

  it('cannot move the first item up or the last down', () => {
    open([item('a', 'One'), item('b', 'Two')]);
    expect(screen.getByRole('button', { name: 'Move item 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move item 2 down' })).toBeDisabled();
  });

  it('asks for the motion wording only when the item needs a motion', async () => {
    const user = userEvent.setup();
    const { rerender } = open([item('a', 'One')]);
    expect(screen.queryByLabelText('Motion wording')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Needs a motion and a second' }));
    expect((onChange.mock.calls[0]?.[0] as AgendaItem[])[0]?.needs_motion).toBe(true);

    rerender(
      <AgendaItemsEditor
        idPrefix="t"
        items={[item('a', 'One', { needs_motion: true, motion_text: 'Move to adopt.' })]}
        onChange={onChange}
      />
    );
    expect(screen.getByLabelText('Motion wording')).toHaveValue('Move to adopt.');
  });

  it('shows linked documents and unlinks one', async () => {
    const user = userEvent.setup();
    open([item('a', 'One', { documents: [{ id: 'd1', name: 'Budget 2027' }] })]);

    expect(screen.getByText('Budget 2027')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unlink Budget 2027' }));
    expect((onChange.mock.calls[0]?.[0] as AgendaItem[])[0]?.documents).toEqual([]);
  });

  it('is read-only when disabled', () => {
    open([item('a', 'One')], true);
    expect(screen.getByLabelText('Item 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add an item' })).not.toBeInTheDocument();
  });
});
