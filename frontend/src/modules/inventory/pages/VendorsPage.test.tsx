import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { InventoryVendor, InventoryVendorContact } from '../types';

const mockGetVendors = vi.fn();
const mockCreateVendor = vi.fn();
const mockUpdateVendor = vi.fn();
const mockDeactivateVendor = vi.fn();
const mockAddVendorContact = vi.fn();
const mockDeleteVendorContact = vi.fn();
const mockGetUnlinkedVendorNames = vi.fn();
const mockAttachVendorName = vi.fn();
const mockMergeVendors = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getVendors: (...a: unknown[]) => mockGetVendors(...a) as unknown,
    createVendor: (...a: unknown[]) => mockCreateVendor(...a) as unknown,
    updateVendor: (...a: unknown[]) => mockUpdateVendor(...a) as unknown,
    deactivateVendor: (...a: unknown[]) => mockDeactivateVendor(...a) as unknown,
    addVendorContact: (...a: unknown[]) => mockAddVendorContact(...a) as unknown,
    updateVendorContact: vi.fn(),
    deleteVendorContact: (...a: unknown[]) => mockDeleteVendorContact(...a) as unknown,
    getUnlinkedVendorNames: (...a: unknown[]) => mockGetUnlinkedVendorNames(...a) as unknown,
    attachVendorName: (...a: unknown[]) => mockAttachVendorName(...a) as unknown,
    mergeVendors: (...a: unknown[]) => mockMergeVendors(...a) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: (p: string) => mockCheckPermission(p) as boolean };
    return selector ? selector(state) : state;
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]): void => {
      mockToastSuccess(...a);
    },
    error: (...a: unknown[]): void => {
      mockToastError(...a);
    },
  },
}));

import VendorsPage from './VendorsPage';

const makeContact = (overrides: Partial<InventoryVendorContact> = {}): InventoryVendorContact => ({
  id: 'c-1',
  organization_id: 'org-1',
  vendor_id: 'v-1',
  name: 'Dana Reyes',
  title: 'Account Manager',
  email: 'dana@galls.test',
  phone: '555-0101',
  is_primary: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeVendor = (overrides: Partial<InventoryVendor> = {}): InventoryVendor => ({
  id: 'v-1',
  organization_id: 'org-1',
  name: 'Galls',
  account_number: 'FCFD-2201',
  phone: '555-0100',
  email: 'orders@galls.test',
  city: 'Lexington',
  state: 'KY',
  is_preferred: true,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  contacts: [makeContact()],
  item_count: 4,
  open_reorder_count: 1,
  total_purchase_value: 1200,
  ...overrides,
});

describe('VendorsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetVendors.mockResolvedValue([]);
    mockCreateVendor.mockResolvedValue(makeVendor());
    mockUpdateVendor.mockResolvedValue(makeVendor());
    mockDeactivateVendor.mockResolvedValue(undefined);
    mockAddVendorContact.mockResolvedValue(makeContact());
    mockDeleteVendorContact.mockResolvedValue(undefined);
    mockCheckPermission.mockReturnValue(true);
    mockGetUnlinkedVendorNames.mockResolvedValue([]);
    mockAttachVendorName.mockResolvedValue({ items_linked: 4, reorders_linked: 2 });
    mockMergeVendors.mockResolvedValue({
      items_moved: 12,
      reorders_moved: 3,
      contacts_moved: 1,
      merged_name: 'Galls Inc.',
      vendor_name: 'Galls',
    });
  });

  it('loads active vendors on mount', async () => {
    renderWithRouter(<VendorsPage />);
    await waitFor(() => {
      expect(mockGetVendors).toHaveBeenCalledWith({ search: undefined, active_only: true });
    });
  });

  it('does not request manager-only cleanup data for view-only users', async () => {
    mockCheckPermission.mockReturnValue(false);

    renderWithRouter(<VendorsPage />);

    await waitFor(() => {
      expect(mockGetVendors).toHaveBeenCalledWith({ search: undefined, active_only: true });
    });
    expect(mockGetUnlinkedVendorNames).not.toHaveBeenCalled();
  });

  it('shows the empty state when no vendors are on file', async () => {
    renderWithRouter(<VendorsPage />);
    expect(await screen.findByText('No vendors yet')).toBeInTheDocument();
  });

  it('shows a vendor with its contact details and purchasing counts', async () => {
    mockGetVendors.mockResolvedValue([makeVendor()]);
    renderWithRouter(<VendorsPage />);

    expect(await screen.findByText('Galls')).toBeInTheDocument();
    expect(screen.getByText('Account FCFD-2201')).toBeInTheDocument();
    expect(screen.getByText('orders@galls.test')).toBeInTheDocument();
    expect(screen.getByText('Dana Reyes')).toBeInTheDocument();
    expect(screen.getByText('4 items')).toBeInTheDocument();
    expect(screen.getByText('1 open reorder')).toBeInTheDocument();
  });

  it('creates a vendor with its primary contact in one pass', async () => {
    const user = userEvent.setup();
    renderWithRouter(<VendorsPage />);
    await screen.findByText('No vendors yet');

    await user.click(screen.getByRole('button', { name: /New Vendor/i }));
    await user.type(screen.getByLabelText('Vendor Name *'), 'Fire Supply Co');
    await user.type(screen.getByLabelText('Name'), 'Alex Chen');
    await user.type(screen.getByLabelText(/^Email$/, { selector: '#vendor-contact-email' }), 'alex@fsc.test');
    await user.click(screen.getByRole('button', { name: 'Add Vendor' }));

    await waitFor(() => {
      expect(mockCreateVendor).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Fire Supply Co',
          contacts: [
            expect.objectContaining({
              name: 'Alex Chen',
              email: 'alex@fsc.test',
              is_primary: true,
            }),
          ],
        })
      );
    });
  });

  it('sends explicit nulls when an edit clears a field', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor()]);
    renderWithRouter(<VendorsPage />);

    await user.click(await screen.findByRole('button', { name: 'Edit Galls' }));
    await user.clear(screen.getByLabelText('Account Number'));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockUpdateVendor).toHaveBeenCalledWith('v-1', expect.objectContaining({ account_number: null }));
    });
  });

  it('deactivates a vendor only after the confirmation is accepted', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor()]);
    renderWithRouter(<VendorsPage />);

    await user.click(await screen.findByRole('button', { name: 'Deactivate Galls' }));
    // The dialog says what survives deactivation, because the items keep their link.
    expect(await screen.findByText(/keep their link/)).toBeInTheDocument();
    expect(mockDeactivateVendor).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => {
      expect(mockDeactivateVendor).toHaveBeenCalledWith('v-1');
    });
  });

  it('reactivates an inactive vendor without a confirmation', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor({ is_active: false })]);
    renderWithRouter(<VendorsPage />);

    await user.click(await screen.findByRole('button', { name: 'Reactivate Galls' }));
    await waitFor(() => {
      expect(mockUpdateVendor).toHaveBeenCalledWith('v-1', { is_active: true });
    });
  });

  it('adds a contact from the contacts modal', async () => {
    const user = userEvent.setup();
    mockGetVendors.mockResolvedValue([makeVendor()]);
    renderWithRouter(<VendorsPage />);

    await user.click(await screen.findByRole('button', { name: /Contacts \(1\)/ }));
    await user.type(screen.getByLabelText('Name *'), 'Sam Ortiz');
    await user.click(screen.getByRole('button', { name: 'Add Contact' }));

    await waitFor(() => {
      expect(mockAddVendorContact).toHaveBeenCalledWith('v-1', expect.objectContaining({ name: 'Sam Ortiz' }));
    });
  });

  it('hides the management actions without inventory.manage', async () => {
    mockCheckPermission.mockReturnValue(false);
    mockGetVendors.mockResolvedValue([makeVendor()]);
    renderWithRouter(<VendorsPage />);

    await screen.findByText('Galls');
    expect(screen.queryByRole('button', { name: /New Vendor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Galls' })).not.toBeInTheDocument();
  });

  it('requests inactive vendors when the toggle is on', async () => {
    const user = userEvent.setup();
    renderWithRouter(<VendorsPage />);
    await screen.findByText('No vendors yet');

    await user.click(screen.getByLabelText('Show inactive'));
    await waitFor(() => {
      expect(mockGetVendors).toHaveBeenCalledWith({ search: undefined, active_only: false });
    });
  });

  describe('names that were never attached to a vendor', () => {
    const unlinked = [{ name: 'Corner Medical Supply', item_count: 9, reorder_count: 2 }];

    it('counts them in a banner', async () => {
      mockGetUnlinkedVendorNames.mockResolvedValue(unlinked);
      renderWithRouter(<VendorsPage />);

      expect(await screen.findByText(/1 supplier name not on the list/)).toBeInTheDocument();
      expect(screen.getByText(/9 items and 2 reorders/)).toBeInTheDocument();
    });

    it('says nothing when every name is on the list', async () => {
      renderWithRouter(<VendorsPage />);
      await screen.findByText('No vendors yet');
      expect(screen.queryByText(/not on the list/)).not.toBeInTheDocument();
    });

    it('keeps the banner from members who cannot act on it', async () => {
      mockCheckPermission.mockReturnValue(false);
      mockGetUnlinkedVendorNames.mockResolvedValue(unlinked);
      renderWithRouter(<VendorsPage />);

      await screen.findByText('No vendors yet');
      expect(screen.queryByText(/not on the list/)).not.toBeInTheDocument();
    });

    it('adds the name as a vendor and attaches its rows in one action', async () => {
      const user = userEvent.setup();
      mockGetUnlinkedVendorNames.mockResolvedValue(unlinked);
      mockCreateVendor.mockResolvedValue(makeVendor({ id: 'v-new', name: 'Corner Medical Supply' }));
      renderWithRouter(<VendorsPage />);

      await user.click(await screen.findByRole('button', { name: /Review and attach/ }));
      await user.click(await screen.findByRole('button', { name: 'Add as vendor' }));

      await waitFor(() => {
        expect(mockCreateVendor).toHaveBeenCalledWith({ name: 'Corner Medical Supply' });
      });
      expect(mockAttachVendorName).toHaveBeenCalledWith('v-new', 'Corner Medical Supply');
    });

    it('attaches the name to a vendor already on the list', async () => {
      const user = userEvent.setup();
      mockGetUnlinkedVendorNames.mockResolvedValue(unlinked);
      mockGetVendors.mockResolvedValue([makeVendor()]);
      renderWithRouter(<VendorsPage />);

      await user.click(await screen.findByRole('button', { name: /Review and attach/ }));
      await user.selectOptions(
        await screen.findByLabelText('Attach Corner Medical Supply to an existing vendor'),
        'v-1'
      );
      await user.click(screen.getByRole('button', { name: 'Attach' }));

      await waitFor(() => {
        expect(mockAttachVendorName).toHaveBeenCalledWith('v-1', 'Corner Medical Supply');
      });
    });
  });

  describe('merging a duplicate', () => {
    it('folds the chosen duplicate into the vendor whose card was used', async () => {
      const user = userEvent.setup();
      mockGetVendors.mockResolvedValue([
        makeVendor(),
        makeVendor({ id: 'v-2', name: 'Galls Inc.', is_preferred: false }),
      ]);
      renderWithRouter(<VendorsPage />);

      await user.click(await screen.findByRole('button', { name: 'Merge a duplicate into Galls' }));
      await user.selectOptions(await screen.findByLabelText('Duplicate to merge in'), 'v-2');
      await user.click(screen.getByRole('button', { name: 'Merge Vendors' }));

      await waitFor(() => {
        expect(mockMergeVendors).toHaveBeenCalledWith('v-1', 'v-2');
      });
    });

    it('will not merge until a duplicate is chosen', async () => {
      const user = userEvent.setup();
      mockGetVendors.mockResolvedValue([makeVendor(), makeVendor({ id: 'v-2', name: 'Galls Inc.' })]);
      renderWithRouter(<VendorsPage />);

      await user.click(await screen.findByRole('button', { name: 'Merge a duplicate into Galls' }));
      expect(await screen.findByRole('button', { name: 'Merge Vendors' })).toBeDisabled();
    });

    it('does not offer a vendor as its own duplicate', async () => {
      const user = userEvent.setup();
      mockGetVendors.mockResolvedValue([makeVendor(), makeVendor({ id: 'v-2', name: 'Galls Inc.' })]);
      renderWithRouter(<VendorsPage />);

      await user.click(await screen.findByRole('button', { name: 'Merge a duplicate into Galls' }));
      await screen.findByLabelText('Duplicate to merge in');
      expect(screen.getByRole('option', { name: 'Galls Inc.' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Galls' })).not.toBeInTheDocument();
    });
  });
});
