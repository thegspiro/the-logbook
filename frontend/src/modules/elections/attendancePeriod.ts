/**
 * The calendar date `months` before `isoDate` (YYYY-MM-DD), clamped to the
 * month's last day -- 31 May less three months is 28 or 29 February, the way
 * the server's `relativedelta` computes its own default period, so a preset
 * here and the server's default name the same first day.
 */
export const monthsBefore = (isoDate: string, months: number): string => {
  const [y = 1970, m = 1, d = 1] = isoDate.split('-').map(Number);
  const totalMonths = y * 12 + (m - 1) - months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12; // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
