/**
 * Vendor display helpers.
 *
 * Kept out of the page so the formatting rules — which address parts to show,
 * which contact a card leads with — are testable and reusable by anything else
 * that has to print a vendor.
 */
import type { InventoryVendor, InventoryVendorContact } from '../types';

/** Join the address parts that are filled in, for a one-line display. */
export function formatVendorAddress(vendor: InventoryVendor): string {
  const cityLine = [vendor.city, vendor.state].filter((part) => part && part.trim()).join(', ');
  return [vendor.address_line1, vendor.address_line2, cityLine, vendor.postal_code, vendor.country]
    .filter((part) => part && part.trim())
    .join(' · ');
}

/** The contact a card should lead with: the primary one, else the first on file. */
export function primaryContact(vendor: InventoryVendor): InventoryVendorContact | undefined {
  return vendor.contacts?.find((c) => c.is_primary) ?? vendor.contacts?.[0];
}

/** A record that names a supplier either by link or by typed-in text. */
export interface VendorNamed {
  vendor_name?: string | undefined;
  vendor?: string | undefined;
}

export interface VendorDisplay {
  /** The name to print. Absent when the record names no supplier at all. */
  name?: string;
  /** Whether that name came from a vendor record rather than a typed string. */
  linked: boolean;
}

/**
 * How a vendor should be named on an item or reorder row, and whether that
 * name is backed by a record.
 *
 * The linked vendor wins over the free-text name: rows carrying both are the
 * ones the backfill linked, where the free text is the older, unreviewed
 * spelling of the same supplier. `linked` is what lets a list mute the rows
 * that are still only text — the ones with no contact and no purchase history
 * behind them.
 */
export function vendorDisplay(record: VendorNamed): VendorDisplay {
  const linkedName = record.vendor_name?.trim();
  if (linkedName) return { name: linkedName, linked: true };
  const typed = record.vendor?.trim();
  return typed ? { name: typed, linked: false } : { linked: false };
}
