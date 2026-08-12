import { describe, it, expect } from 'vitest';
import {
  ITEM_TYPES,
  STATUS_OPTIONS,
  STORAGE_TYPES,
  ITEM_TYPE_FIELDS,
  getStatusStyle,
  getStatusLabel,
  getConditionColor,
  getItemTypeFromCategory,
  sizeLabel,
} from './index';

describe('ITEM_TYPES', () => {
  it('contains expected item types', () => {
    const values = ITEM_TYPES.map((t) => t.value);
    expect(values).toContain('uniform');
    expect(values).toContain('ppe');
    expect(values).toContain('electronics');
    expect(values).toContain('tool');
    expect(values).toContain('equipment');
    expect(values).toContain('vehicle');
    expect(values).toContain('consumable');
    expect(values).toContain('other');
  });

  it('has labels for each type', () => {
    for (const item of ITEM_TYPES) {
      expect(item.label).not.toBe('');
    }
  });
});

describe('STATUS_OPTIONS', () => {
  it('contains expected statuses', () => {
    const values = STATUS_OPTIONS.map((s) => s.value);
    expect(values).toContain('available');
    expect(values).toContain('assigned');
    expect(values).toContain('checked_out');
    expect(values).toContain('in_maintenance');
    expect(values).toContain('lost');
    expect(values).toContain('stolen');
    expect(values).toContain('retired');
  });

  it('each status has a color class string', () => {
    for (const status of STATUS_OPTIONS) {
      expect(status.color).toContain('bg-');
      expect(status.color).toContain('text-');
    }
  });
});

describe('STORAGE_TYPES', () => {
  it('contains expected storage types', () => {
    const values = STORAGE_TYPES.map((t) => t.value);
    expect(values).toContain('rack');
    expect(values).toContain('shelf');
    expect(values).toContain('cabinet');
    expect(values).toContain('bin');
  });
});

describe('ITEM_TYPE_FIELDS', () => {
  it('electronics includes serial_number and warranty_expiration', () => {
    expect(ITEM_TYPE_FIELDS['electronics']).toContain('serial_number');
    expect(ITEM_TYPE_FIELDS['electronics']).toContain('warranty_expiration');
  });

  it('uniform includes size and color', () => {
    expect(ITEM_TYPE_FIELDS['uniform']).toContain('size');
    expect(ITEM_TYPE_FIELDS['uniform']).toContain('color');
  });

  it('ppe includes inspection fields', () => {
    expect(ITEM_TYPE_FIELDS['ppe']).toContain('inspection_interval_days');
    expect(ITEM_TYPE_FIELDS['ppe']).toContain('last_inspection_date');
  });

  it('other type has empty fields', () => {
    expect(ITEM_TYPE_FIELDS['other']).toEqual([]);
  });
});

describe('getStatusStyle', () => {
  it('returns color class for known statuses', () => {
    const style = getStatusStyle('available');
    expect(style).toContain('green');
  });

  it('returns default style for unknown status', () => {
    const style = getStatusStyle('unknown_status');
    expect(style).toContain('bg-theme-surface-secondary');
  });
});

describe('getConditionColor', () => {
  it('returns green for excellent', () => {
    expect(getConditionColor('excellent')).toContain('green');
  });

  it('returns yellow for fair', () => {
    expect(getConditionColor('fair')).toContain('yellow');
  });

  it('returns red for damaged', () => {
    expect(getConditionColor('damaged')).toContain('red');
  });

  it('returns red for out_of_service', () => {
    expect(getConditionColor('out_of_service')).toContain('red');
  });

  it('returns muted for unknown condition', () => {
    expect(getConditionColor('unknown')).toContain('text-theme-text-muted');
  });
});

describe('getItemTypeFromCategory', () => {
  it('returns item_type from category', () => {
    const category = { item_type: 'ppe' } as Parameters<typeof getItemTypeFromCategory>[0];
    expect(getItemTypeFromCategory(category)).toBe('ppe');
  });

  it('returns "equipment" for null category', () => {
    expect(getItemTypeFromCategory(null)).toBe('equipment');
  });

  it('returns "equipment" for undefined category', () => {
    expect(getItemTypeFromCategory(undefined)).toBe('equipment');
  });
});

describe('sizeLabel', () => {
  // Sizes are stored as lowercase codes. The Impact Planner printed them
  // straight into its size breakdown and its member table, so a quartermaster
  // planning a shirt order read "l" and "xl" where every dropdown in the
  // application says "L" and "XL".
  it.each([
    ['s', 'S'],
    ['m', 'M'],
    ['l', 'L'],
    ['xl', 'XL'],
    ['xxxl', '3XL'],
    ['one_size', 'One Size'],
  ])('renders %s as %s', (code, label) => {
    expect(sizeLabel(code)).toBe(label);
  });

  it('is case-insensitive about the stored code', () => {
    expect(sizeLabel('XL')).toBe('XL');
  });

  it('returns anything outside the list unchanged', () => {
    // A numeric waist or a boot width is a size too, and mangling it would be
    // worse than printing it.
    expect(sizeLabel('34')).toBe('34');
    expect(sizeLabel('10.5 EE')).toBe('10.5 EE');
  });

  it('returns an empty string for no size on file', () => {
    expect(sizeLabel(null)).toBe('');
    expect(sizeLabel(undefined)).toBe('');
    expect(sizeLabel('')).toBe('');
  });
});

describe('getStatusLabel', () => {
  // The detail page and the storage-area list used to print the stored value
  // straight out, so "checked_out" reached the reader as "checked out" beside
  // a properly-cased Condition and Tracking in the same row of three.
  it.each([
    ['available', 'Available'],
    ['assigned', 'Assigned'],
    ['checked_out', 'Checked Out'],
  ])('renders %s as %s', (value, label) => {
    expect(getStatusLabel(value)).toBe(label);
  });

  it('gives every option in STATUS_OPTIONS its own label', () => {
    for (const option of STATUS_OPTIONS) {
      expect(getStatusLabel(option.value)).toBe(option.label);
    }
  });

  it('falls back to the underscored value made readable', () => {
    // A status stored before it was added to the list is still better shown
    // than swallowed.
    expect(getStatusLabel('pending_disposal')).toBe('pending disposal');
  });
});
