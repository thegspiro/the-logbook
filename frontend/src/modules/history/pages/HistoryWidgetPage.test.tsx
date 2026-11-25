import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { HistoryWidgetToday } from '../types';

const mockToday = vi.fn();

vi.mock('../services/publicWidget', () => ({
  historyWidgetService: {
    today: (...args: unknown[]) => mockToday(...args) as unknown,
  },
}));

import { HistoryWidgetPage } from './HistoryWidgetPage';

const TOKEN = 'a'.repeat(43);

const answer = (overrides: Partial<HistoryWidgetToday> = {}): HistoryWidgetToday => ({
  mode: 'today',
  date: '2026-03-04',
  entries: [
    {
      key: 'event:e1',
      kind: 'event',
      date: '1911-03-04',
      precision: 'day',
      circa: false,
      label: 'Mill fire',
      detail: 'Main Street',
      years_ago: 115,
      anniversary: '2026-03-04',
      anniversary_label: 'March 4',
    },
  ],
  theme: 'light',
  organization_name: 'Hose Company 1',
  has_logo: false,
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/embed/history/${TOKEN}`]}>
      <Routes>
        <Route path="/embed/history/:token" element={<HistoryWidgetPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('HistoryWidgetPage', () => {
  beforeEach(() => {
    mockToday.mockReset();
    mockToday.mockResolvedValue(answer());
  });

  it("shows today's entries for the widget's own link", async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Today in history' })).toBeInTheDocument();
    expect(mockToday).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText('Mill fire')).toBeInTheDocument();
    expect(screen.getByText(/115 years ago/)).toBeInTheDocument();
    expect(screen.getByText('Hose Company 1')).toBeInTheDocument();
  });

  it('names the day for "This week in history"', async () => {
    mockToday.mockResolvedValue(
      answer({
        mode: 'week',
        date: '2026-02-28',
        entries: answer().entries.map((entry) => ({ ...entry, anniversary: '2026-03-04' })),
      })
    );
    renderPage();
    expect(await screen.findByRole('heading', { name: 'This week in history' })).toBeInTheDocument();
    expect(screen.getByText('March 4, 1911')).toBeInTheDocument();
  });

  it('renders nothing on an empty week or a refused link', async () => {
    mockToday.mockResolvedValue(answer({ mode: 'none', entries: [] }));
    const { container, unmount } = renderPage();
    await waitFor(() => expect(mockToday).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
    unmount();

    mockToday.mockRejectedValue(new Error('404'));
    const view = renderPage();
    await waitFor(() => expect(mockToday).toHaveBeenCalledTimes(2));
    expect(view.container).toBeEmptyDOMElement();
  });

  it('draws the chosen style and leaves branding out when asked', async () => {
    mockToday.mockResolvedValue(answer({ theme: 'dark', organization_name: null }));
    renderPage();
    const main = await screen.findByRole('main');
    expect(main).toHaveAttribute('data-theme', 'dark');
    expect(screen.queryByText('Hose Company 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
