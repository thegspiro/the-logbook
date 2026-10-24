import { describe, it, expect } from 'vitest';
import {
  EMPTY_CONTACT_ROW,
  buildBudgetSummary,
  buildKeyContacts,
  budgetSummaryErrors,
  emptyBudgetAmounts,
  keyContactErrors,
  readBudgetSummary,
  readKeyContacts,
} from './applicationStructuredFields';

describe('budget summary', () => {
  it('builds an amount per filled category, plus notes', () => {
    const amounts = { ...emptyBudgetAmounts(), equipment: '85000', training: ' 12500.50 ' };

    expect(buildBudgetSummary(amounts, ' SCBA replacement ')).toEqual({
      equipment: 85000,
      training: 12500.5,
      notes: 'SCBA replacement',
    });
  });

  it('is null when nothing is filled in, so an edit can clear it', () => {
    expect(buildBudgetSummary(emptyBudgetAmounts(), '  ')).toBeNull();
  });

  it('keeps a zero amount', () => {
    expect(buildBudgetSummary({ ...emptyBudgetAmounts(), travel: '0' }, '')).toEqual({ travel: 0 });
  });

  it('reads a stored summary back into form values', () => {
    const { amounts, notes } = readBudgetSummary({ personnel: 4000, notes: 'Overtime' });

    expect(amounts.personnel).toBe('4000');
    expect(amounts.equipment).toBe('');
    expect(notes).toBe('Overtime');
  });

  it.each([null, 'free text', ['a'], { equipment: 'lots' }])('ignores a stored value of the wrong shape: %j', (raw) => {
    const { amounts, notes } = readBudgetSummary(raw);

    expect(Object.values(amounts).every((value) => value === '')).toBe(true);
    expect(notes).toBe('');
  });

  it('flags a negative or non-numeric amount', () => {
    expect(budgetSummaryErrors({ ...emptyBudgetAmounts(), supplies: '-5' })).toMatch(/0 or more/);
    expect(budgetSummaryErrors({ ...emptyBudgetAmounts(), supplies: '12' })).toBeNull();
  });
});

describe('key contacts', () => {
  it('builds trimmed contacts, leaving out empty optional fields and blank rows', () => {
    const rows = [
      { name: ' Dana Ruiz ', role: 'Program officer', phone: '', email: 'dana@afg.gov' },
      { ...EMPTY_CONTACT_ROW },
    ];

    expect(buildKeyContacts(rows)).toEqual([{ name: 'Dana Ruiz', role: 'Program officer', email: 'dana@afg.gov' }]);
  });

  it('is null when every row is removed or blank, so an edit can clear the list', () => {
    expect(buildKeyContacts([])).toBeNull();
    expect(buildKeyContacts([{ ...EMPTY_CONTACT_ROW }])).toBeNull();
  });

  it('requires a name on any row that has something in it', () => {
    expect(keyContactErrors([{ ...EMPTY_CONTACT_ROW, role: 'Signatory' }])).toMatch(/needs a name/);
    expect(keyContactErrors([{ ...EMPTY_CONTACT_ROW }])).toBeNull();
  });

  it('reads stored contacts and drops entries it cannot show', () => {
    expect(readKeyContacts([{ name: 'Chief Lee', phone: '555-0100' }, { contact: 'no name' }, 'text'])).toEqual([
      { name: 'Chief Lee', role: '', phone: '555-0100', email: '' },
    ]);
    expect(readKeyContacts('Dana, program officer')).toEqual([]);
  });
});
