import { describe, it, expect } from 'vitest';
import { formatVendorAddress, primaryContact, vendorDisplay } from './vendorHelpers';
import type { InventoryVendor, InventoryVendorContact } from '../types';

const makeContact = (overrides: Partial<InventoryVendorContact> = {}): InventoryVendorContact => ({
  id: 'c-1',
  organization_id: 'org-1',
  vendor_id: 'v-1',
  name: 'Dana Reyes',
  is_primary: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeVendor = (overrides: Partial<InventoryVendor> = {}): InventoryVendor => ({
  id: 'v-1',
  organization_id: 'org-1',
  name: 'Galls',
  is_preferred: false,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  contacts: [],
  item_count: 0,
  open_reorder_count: 0,
  ...overrides,
});

describe('formatVendorAddress', () => {
  it('joins the parts that are filled in', () => {
    const vendor = makeVendor({
      address_line1: '1340 Russell Cave Rd',
      city: 'Lexington',
      state: 'KY',
      postal_code: '40505',
    });
    expect(formatVendorAddress(vendor)).toBe('1340 Russell Cave Rd · Lexington, KY · 40505');
  });

  it('leaves out the city line when neither city nor state is set', () => {
    expect(formatVendorAddress(makeVendor({ address_line1: 'PO Box 12', postal_code: '22046' }))).toBe(
      'PO Box 12 · 22046'
    );
  });

  it('returns an empty string when no address is on file', () => {
    expect(formatVendorAddress(makeVendor())).toBe('');
  });

  it('ignores whitespace-only parts rather than printing empty separators', () => {
    expect(formatVendorAddress(makeVendor({ address_line1: '   ', city: 'Falls Church' }))).toBe('Falls Church');
  });
});

describe('primaryContact', () => {
  it('prefers the flagged primary over the first on file', () => {
    const vendor = makeVendor({
      contacts: [makeContact({ id: 'c-1', name: 'Alex' }), makeContact({ id: 'c-2', name: 'Dana', is_primary: true })],
    });
    expect(primaryContact(vendor)?.name).toBe('Dana');
  });

  it('falls back to the first contact when none is flagged', () => {
    const vendor = makeVendor({ contacts: [makeContact({ name: 'Alex' }), makeContact({ id: 'c-2', name: 'Dana' })] });
    expect(primaryContact(vendor)?.name).toBe('Alex');
  });

  it('returns undefined when the vendor has no contacts', () => {
    expect(primaryContact(makeVendor())).toBeUndefined();
  });
});

describe('vendorDisplay', () => {
  it('prefers the linked vendor name over the free-text one', () => {
    expect(vendorDisplay({ vendor_name: 'Galls', vendor: 'galls inc' })).toEqual({ name: 'Galls', linked: true });
  });

  it('reports a free-text-only name as unlinked', () => {
    expect(vendorDisplay({ vendor: 'Corner Hardware' })).toEqual({ name: 'Corner Hardware', linked: false });
  });

  it('has no name when neither is set', () => {
    expect(vendorDisplay({})).toEqual({ linked: false });
  });

  it('treats a whitespace-only name as no name at all', () => {
    expect(vendorDisplay({ vendor_name: '  ', vendor: '  ' })).toEqual({ linked: false });
  });

  it('falls through to the typed name when the linked one is blank', () => {
    expect(vendorDisplay({ vendor_name: '   ', vendor: 'Corner Hardware' })).toEqual({
      name: 'Corner Hardware',
      linked: false,
    });
  });

  it('trims the name it returns', () => {
    expect(vendorDisplay({ vendor_name: ' Galls ' })).toEqual({ name: 'Galls', linked: true });
  });
});
