/**
 * The range a money amount can take on the finance forms.
 *
 * Every finance amount column is `Numeric(12, 2)`, which holds at most
 * 9,999,999,999.99, and the API rejects anything with more than 12 digits
 * (`max_digits=12`). The forms check the same range, so an amount that cannot
 * be stored is turned back with a message at the field rather than reaching
 * the server. The smallest amount is one cent: anything finer rounds to
 * "0.00" when it is sent, which the API then refuses as "not greater than 0".
 */

export const MIN_MONEY_AMOUNT = 0.01;
export const MAX_MONEY_AMOUNT = 9_999_999_999.99;

export const MIN_MONEY_MESSAGE = 'Amount must be at least $0.01';
export const MAX_MONEY_MESSAGE = 'That amount is too large.';
