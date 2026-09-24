/**
 * Data Exposure Control — the PII badge and what hangs off it.
 *
 * The screen's job is to make one judgement visible at the moment somebody
 * makes a decision: this field identifies a person, so think before you
 * publish it. That judgement is rendered from `is_sensitive`, which the
 * backend never sent — so the badge never appeared, the "sensitive fields
 * enabled" warning was permanently absent, and the counter beside it read 0
 * however many personal contact fields a department had opened up.
 *
 * Nothing failed while that was true. The page rendered, every field looked
 * equally safe, and the only way to notice was to know what should have been
 * there. These tests are the thing that notices.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicPortalDataWhitelist } from '../types';

const mockGetWhitelist = vi.fn();
const mockUpdateWhitelistEntry = vi.fn();
const mockBulkUpdateWhitelist = vi.fn();

vi.mock('../services/publicPortalApi', () => ({
  getWhitelist: (...a: unknown[]) => mockGetWhitelist(...a) as unknown,
  updateWhitelistEntry: (...a: unknown[]) => mockUpdateWhitelistEntry(...a) as unknown,
  bulkUpdateWhitelist: (...a: unknown[]) => mockBulkUpdateWhitelist(...a) as unknown,
}));

vi.mock('react-hot-toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Import the component AFTER the mocks are in place.
import { DataWhitelistTab } from './DataWhitelistTab';

const field = (
  overrides: Partial<PublicPortalDataWhitelist> & { field_name: string; category: string }
): PublicPortalDataWhitelist => ({
  id: `${overrides.category}.${overrides.field_name}`,
  organization_id: 'org-1',
  data_category: overrides.category,
  field_name: overrides.field_name,
  is_enabled: false,
  is_sensitive: false,
  description: null,
  created_at: '2026-09-24T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
  ...overrides,
});

/** What the endpoint now serves: the catalogue, classified. */
const CATALOGUE: PublicPortalDataWhitelist[] = [
  field({ category: 'organization', field_name: 'name', description: "The department's name." }),
  field({
    category: 'organization',
    field_name: 'email',
    is_sensitive: true,
    description: 'Published contact address. Often an individual’s inbox.',
  }),
  field({ category: 'organization', field_name: 'phone', is_sensitive: true }),
  field({ category: 'stats', field_name: 'total_members' }),
];

const renderTab = async () => {
  render(<DataWhitelistTab />);
  await screen.findByText('total_members');
};

/** The row a field's name sits in, so a badge is asserted against its own field. */
const rowFor = (fieldName: string): HTMLElement => {
  const code = screen.getByText(fieldName);
  const row = code.closest('div.px-6');
  if (!row) throw new Error(`no row found for ${fieldName}`);
  return row as HTMLElement;
};

describe('DataWhitelistTab', () => {
  // This block states the implementation it depends on rather than inheriting
  // one: vi.clearAllMocks() would leave a previous block's resolved value in
  // place (CLAUDE.md #28).
  beforeEach(() => {
    mockGetWhitelist.mockReset();
    mockUpdateWhitelistEntry.mockReset();
    mockBulkUpdateWhitelist.mockReset();
    mockGetWhitelist.mockResolvedValue(CATALOGUE);
    mockUpdateWhitelistEntry.mockResolvedValue({});
  });

  describe('the PII badge', () => {
    it('marks a field that carries personal contact details', async () => {
      await renderTab();

      expect(within(rowFor('email')).getByText('PII')).toBeInTheDocument();
      expect(within(rowFor('phone')).getByText('PII')).toBeInTheDocument();
    });

    it('leaves an ordinary field unmarked', async () => {
      await renderTab();

      expect(within(rowFor('name')).queryByText('PII')).not.toBeInTheDocument();
      expect(within(rowFor('total_members')).queryByText('PII')).not.toBeInTheDocument();
    });

    it('shows the field description the badge is judged against', async () => {
      await renderTab();

      expect(screen.getByText(/Often an individual/)).toBeInTheDocument();
    });
  });

  describe('the sensitive-field warning', () => {
    it('stays quiet while no sensitive field is enabled', async () => {
      await renderTab();

      expect(screen.queryByText(/sensitive field/)).not.toBeInTheDocument();
    });

    it('counts and names the sensitive fields a department has published', async () => {
      mockGetWhitelist.mockResolvedValue(CATALOGUE.map((f) => (f.is_sensitive ? { ...f, is_enabled: true } : f)));

      await renderTab();

      // Both the warning above the list and the counter card read the same
      // number — the screen's whole claim is that they describe reality.
      expect(screen.getByText(/You currently have 2 sensitive fields enabled/)).toBeInTheDocument();
      const card = screen.getByText('Sensitive (PII)').closest('div.card') as HTMLElement;
      expect(within(card).getByText('2')).toBeInTheDocument();
    });

    it('uses the singular for one field', async () => {
      mockGetWhitelist.mockResolvedValue(
        CATALOGUE.map((f) => (f.field_name === 'email' ? { ...f, is_enabled: true } : f))
      );

      await renderTab();

      expect(screen.getByText(/have 1 sensitive field enabled/)).toBeInTheDocument();
    });
  });

  describe('grouping and search', () => {
    it('groups fields under their own category', async () => {
      await renderTab();

      // Grouping read `category`, which was undefined on the wire, so every
      // field landed in one section headed "Undefined".
      expect(screen.getByText('Organization')).toBeInTheDocument();
      expect(screen.getByText('Stats')).toBeInTheDocument();
      expect(screen.queryByText('Undefined')).not.toBeInTheDocument();
    });

    it('searches by category without throwing', async () => {
      await renderTab();
      const user = userEvent.setup();

      // A term matching no field name falls through to `field.category`,
      // which threw and took the tab down to the error boundary.
      await user.type(screen.getByLabelText(/Search by field name/), 'stats');

      expect(screen.getByText('total_members')).toBeInTheDocument();
      expect(screen.queryByText('email')).not.toBeInTheDocument();
    });
  });

  it('reports no percentage rather than NaN when nothing is configured', async () => {
    mockGetWhitelist.mockResolvedValue([]);
    render(<DataWhitelistTab />);

    await screen.findByText('No fields found');
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
