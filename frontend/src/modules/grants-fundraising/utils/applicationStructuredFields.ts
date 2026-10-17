/**
 * The budget summary and key contacts on a grant application are structured
 * (an amount per budget category; a list of named contacts). These helpers
 * turn them into form state and back, and read stored values defensively:
 * both are untyped JSON columns, and a value written straight through the API
 * before the request schema was tightened can be any shape.
 */
import { BudgetItemCategory } from '../types';
import type { GrantBudgetSummary, GrantKeyContact } from '../types';

export const BUDGET_CATEGORY_ORDER: BudgetItemCategory[] = Object.values(BudgetItemCategory);

export type BudgetAmounts = Record<BudgetItemCategory, string>;

export interface ContactRow {
  name: string;
  role: string;
  phone: string;
  email: string;
}

export const EMPTY_CONTACT_ROW: ContactRow = { name: '', role: '', phone: '', email: '' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

export const emptyBudgetAmounts = (): BudgetAmounts =>
  Object.fromEntries(BUDGET_CATEGORY_ORDER.map((c) => [c, ''])) as BudgetAmounts;

export function readBudgetSummary(raw: unknown): { amounts: BudgetAmounts; notes: string } {
  const amounts = emptyBudgetAmounts();
  if (!isRecord(raw)) return { amounts, notes: '' };
  for (const category of BUDGET_CATEGORY_ORDER) {
    const value = raw[category];
    if (typeof value === 'number' && Number.isFinite(value)) amounts[category] = String(value);
  }
  return { amounts, notes: asText(raw.notes) };
}

/** `null` when nothing is filled in, so an edit that empties every box clears the stored summary. */
export function buildBudgetSummary(amounts: BudgetAmounts, notes: string): GrantBudgetSummary | null {
  const summary: GrantBudgetSummary = {};
  for (const category of BUDGET_CATEGORY_ORDER) {
    const text = amounts[category].trim();
    if (text !== '') summary[category] = Number(text);
  }
  if (notes.trim()) summary.notes = notes.trim();
  return Object.keys(summary).length > 0 ? summary : null;
}

export function budgetSummaryErrors(amounts: BudgetAmounts): string | null {
  for (const category of BUDGET_CATEGORY_ORDER) {
    const text = amounts[category].trim();
    if (text !== '' && (!Number.isFinite(Number(text)) || Number(text) < 0)) {
      return 'Budget amounts must be numbers of 0 or more';
    }
  }
  return null;
}

/** Entries without a name are dropped: there is no contact without one. */
export function readKeyContacts(raw: unknown): ContactRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).flatMap((entry) => {
    const name = asText(entry.name);
    if (!name) return [];
    return [{ name, role: asText(entry.role), phone: asText(entry.phone), email: asText(entry.email) }];
  });
}

const isBlankRow = (row: ContactRow) => !row.name.trim() && !row.role.trim() && !row.phone.trim() && !row.email.trim();

export function keyContactErrors(rows: ContactRow[]): string | null {
  return rows.some((row) => !isBlankRow(row) && !row.name.trim()) ? 'Each contact needs a name' : null;
}

/** `null` when no contact is entered, so removing the last one clears the stored list. */
export function buildKeyContacts(rows: ContactRow[]): GrantKeyContact[] | null {
  const contacts = rows
    .filter((row) => !isBlankRow(row))
    .map((row) => {
      const contact: GrantKeyContact = { name: row.name.trim() };
      if (row.role.trim()) contact.role = row.role.trim();
      if (row.phone.trim()) contact.phone = row.phone.trim();
      if (row.email.trim()) contact.email = row.email.trim();
      return contact;
    });
  return contacts.length > 0 ? contacts : null;
}
