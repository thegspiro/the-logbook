import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { HistoryPublicSettings } from '../types';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockMake = vi.fn();
const mockRemove = vi.fn();

vi.mock('../services/api', () => ({
  historyService: {
    getPublicSettings: (...args: unknown[]) => mockGet(...args) as unknown,
    updatePublicSettings: (...args: unknown[]) => mockUpdate(...args) as unknown,
    makeWidgetLink: (...args: unknown[]) => mockMake(...args) as unknown,
    removeWidgetLink: (...args: unknown[]) => mockRemove(...args) as unknown,
  },
}));

import { PublicWebsiteSettings } from './PublicWebsiteSettings';
import { buildHistoryWidgetSnippet } from '../utils/widgetSnippet';

const settings = (overrides: Partial<HistoryPublicSettings> = {}): HistoryPublicSettings => ({
  people: false,
  honor_roll: false,
  photos: false,
  documents: false,
  events: false,
  apparatus: false,
  articles: false,
  timeline: false,
  today: false,
  widget_theme: 'auto',
  widget_show_branding: true,
  widget_link_exists: false,
  widget_token_created_at: null,
  portal_enabled: true,
  portal_has_key: true,
  widget_websites: ['https://www.example-fd.org'],
  ...overrides,
});

const TOKEN = 'b'.repeat(43);

describe('PublicWebsiteSettings', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockMake.mockReset();
    mockRemove.mockReset();
    mockGet.mockResolvedValue(settings());
    mockUpdate.mockImplementation((values: Partial<HistoryPublicSettings>) => Promise.resolve(settings(values)));
    mockMake.mockResolvedValue(TOKEN);
  });

  it('starts with every part off and saves one switch at a time', async () => {
    renderWithRouter(<PublicWebsiteSettings />);
    const people = await screen.findByRole('checkbox', { name: /^People/ });
    expect(people).not.toBeChecked();
    await userEvent.click(people);
    expect(mockUpdate).toHaveBeenCalledWith({ people: true });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /^People/ })).toBeChecked());
  });

  it('shows the widget code once, after making the link', async () => {
    mockGet.mockResolvedValueOnce(settings()).mockResolvedValue(settings({ widget_link_exists: true }));
    renderWithRouter(<PublicWebsiteSettings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make a widget link' }));
    const code = await screen.findByLabelText(/Paste this into your website/);
    expect(code).toHaveValue(buildHistoryWidgetSnippet(window.location.origin, TOKEN));
    expect(screen.getByRole('button', { name: 'Replace the link' })).toBeInTheDocument();
  });

  it('says why nothing will show', async () => {
    mockGet.mockResolvedValue(settings({ portal_has_key: false, widget_websites: [] }));
    renderWithRouter(<PublicWebsiteSettings />);
    expect(await screen.findByText(/no active API key/)).toBeInTheDocument();
    expect(screen.getByText(/has not listed its website yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Organization Settings/ })).toHaveAttribute('href', '/settings?tab=forms');
  });

  it('builds an iframe that names only the widget link', () => {
    expect(buildHistoryWidgetSnippet('https://logbook.example.org', TOKEN)).toBe(
      `<iframe src="https://logbook.example.org/embed/history/${TOKEN}" title="Today in history" style="width:100%;height:260px;border:0" loading="lazy"></iframe>`
    );
  });
});
