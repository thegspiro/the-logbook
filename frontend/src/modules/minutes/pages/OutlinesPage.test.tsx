import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetOutlines = vi.fn();
const mockGetOutline = vi.fn();
const mockUpdateOutline = vi.fn();
const mockDeleteOutline = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getOutlines: (...a: unknown[]) => mockGetOutlines(...a) as unknown,
    getOutline: (...a: unknown[]) => mockGetOutline(...a) as unknown,
    updateOutline: (...a: unknown[]) => mockUpdateOutline(...a) as unknown,
    deleteOutline: (...a: unknown[]) => mockDeleteOutline(...a) as unknown,
    createOutline: vi.fn(),
  },
}));

import { OutlinesPage } from './OutlinesPage';
import { renderWithRouter } from '../../../test/utils';
import type { MinutesTemplate, TemplateListItem } from '../types/minutes';

const list: TemplateListItem[] = [
  { id: 'o1', name: 'Regular order', meeting_type: 'business', is_default: true, section_count: 8, created_at: '' },
  { id: 'o2', name: 'Short order', meeting_type: 'business', is_default: false, section_count: 4, created_at: '' },
  { id: 'o3', name: 'Board order', meeting_type: 'special', is_default: true, section_count: 5, created_at: '' },
];

const full: MinutesTemplate = {
  id: 'o2',
  organization_id: 'org',
  name: 'Short order',
  description: null,
  meeting_type: 'business',
  is_default: false,
  sections: [{ order: 0, key: 'call_to_order', title: 'Call to Order', default_content: '', required: true }],
  header_config: {},
  footer_config: {},
  created_at: '',
  updated_at: '',
};

describe('OutlinesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOutlines.mockReset();
    mockGetOutline.mockReset();
    mockUpdateOutline.mockReset();
    mockDeleteOutline.mockReset();
    mockGetOutlines.mockResolvedValue(list);
    mockGetOutline.mockResolvedValue(full);
    mockUpdateOutline.mockResolvedValue(full);
    mockDeleteOutline.mockResolvedValue(undefined);
  });

  it('groups outlines by kind of meeting and marks the default', async () => {
    renderWithRouter(<OutlinesPage />);
    expect(await screen.findByText('Regular order')).toBeInTheDocument();
    const business = screen.getByRole('region', { name: 'Business meeting' });
    expect(within(business).getByText('Short order')).toBeInTheDocument();
    expect(within(business).getAllByText('Default')).toHaveLength(1);
    expect(screen.getByText('Board order')).toBeInTheDocument();
  });

  it('only offers "Make default" on an outline that is not already the default', async () => {
    renderWithRouter(<OutlinesPage />);
    await screen.findByText('Regular order');
    expect(screen.queryByRole('button', { name: 'Make Regular order the default' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make Short order the default' })).toBeInTheDocument();
  });

  it('makes an outline the default and reloads the list', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutlinesPage />);
    await screen.findByText('Regular order');
    await user.click(screen.getByRole('button', { name: 'Make Short order the default' }));
    await waitFor(() => expect(mockUpdateOutline).toHaveBeenCalledWith('o2', { is_default: true }));
    await waitFor(() => expect(mockGetOutlines).toHaveBeenCalledTimes(2));
  });

  it('opens the full outline for editing', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutlinesPage />);
    await screen.findByText('Regular order');
    await user.click(screen.getByRole('button', { name: 'Edit Short order' }));
    await waitFor(() => expect(mockGetOutline).toHaveBeenCalledWith('o2'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('deletes only after confirmation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutlinesPage />);
    await screen.findByText('Regular order');
    await user.click(screen.getByRole('button', { name: 'Delete Short order' }));
    expect(mockDeleteOutline).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Delete outline' }));
    await waitFor(() => expect(mockDeleteOutline).toHaveBeenCalledWith('o2'));
  });

  it('keeps the outline when the confirmation is declined', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutlinesPage />);
    await screen.findByText('Regular order');
    await user.click(screen.getByRole('button', { name: 'Delete Short order' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(mockDeleteOutline).not.toHaveBeenCalled();
  });

  it('shows an error when the list cannot be loaded', async () => {
    mockGetOutlines.mockRejectedValue(new Error('boom'));
    renderWithRouter(<OutlinesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/boom|Failed to load/);
  });
});
