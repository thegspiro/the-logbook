import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { MergePreview } from '../types';

const mockGetPerson = vi.fn();
const mockPreview = vi.fn();
const mockMerge = vi.fn();

vi.mock('../services/api', () => ({
  historyService: {
    getPerson: (...args: unknown[]) => mockGetPerson(...args) as unknown,
    mergePreview: (...args: unknown[]) => mockPreview(...args) as unknown,
    mergePerson: (...args: unknown[]) => mockMerge(...args) as unknown,
    listPeople: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import HistoryMergePage from './HistoryMergePage';

const side = (id: string, name: string) => ({
  id,
  display_name: name,
  service_years: '1951–1962',
  publication_level: 'draft' as const,
  period_count: 1,
  relation_count: 0,
  linked_member_name: null,
  is_memorial: false,
  is_line_of_duty_death: false,
});

const preview = (overrides: Partial<MergePreview> = {}): MergePreview => ({
  keep: side('p1', 'John Smith'),
  other: side('p2', 'Jack Smith'),
  fields: [
    {
      field: 'first_name',
      label: 'First name',
      keep_value: 'John',
      other_value: 'Jack',
      state: 'differs',
      can_keep_both: false,
    },
    {
      field: 'research_notes',
      label: 'Research notes',
      keep_value: 'From the minutes',
      other_value: 'From his daughter',
      state: 'differs',
      can_keep_both: true,
    },
    {
      field: 'nickname',
      label: 'Nickname',
      keep_value: null,
      other_value: 'Jack',
      state: 'keep_blank',
      can_keep_both: false,
    },
  ],
  refusal: null,
  warnings: [],
  ...overrides,
});

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/history/people/p1/merge?other=p2']}>
        <Routes>
          <Route path="/history/people/:personId/merge" element={<HistoryMergePage />} />
          <Route path="/history/people/:personId" element={<p>Person page</p>} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('HistoryMergePage', () => {
  beforeEach(() => {
    mockGetPerson.mockReset();
    mockGetPerson.mockResolvedValue({ id: 'p1', display_name: 'John Smith', view: 'full' });
    mockPreview.mockReset();
    mockMerge.mockReset();
  });

  it('waits for a choice on every difference, then merges with the choices', async () => {
    mockPreview.mockResolvedValue(preview());
    mockMerge.mockResolvedValue({});
    renderPage();

    expect(await screen.findByRole('button', { name: 'Choose 2 more values' })).toBeDisabled();
    expect(screen.getByText('Nickname: Jack')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'John' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Keep both, one after the other' }));
    await userEvent.click(screen.getByRole('button', { name: 'Merge records' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Merge' }));

    expect(mockPreview).toHaveBeenCalledWith('p1', 'p2');
    expect(mockMerge).toHaveBeenCalledWith('p1', 'p2', { first_name: 'keep', research_notes: 'both' });
    expect(await screen.findByText('Person page')).toBeInTheDocument();
  });

  it('shows the server’s refusal and offers no merge', async () => {
    mockPreview.mockResolvedValue(
      preview({ refusal: 'These records are linked to different member accounts.', fields: [] })
    );
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('different member accounts');
    expect(screen.queryByRole('button', { name: /Merge/ })).not.toBeInTheDocument();
  });

  it('shows the server’s warnings', async () => {
    mockPreview.mockResolvedValue(preview({ warnings: ['The merged record stays draft.'] }));
    renderPage();
    expect(await screen.findByText('The merged record stays draft.')).toBeInTheDocument();
  });
});
