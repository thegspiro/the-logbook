/**
 * Display helpers for archive dates and the archive's own HTML.
 */

import DOMPurify from 'dompurify';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import type { DatePrecision } from '../types';

/**
 * A partial date as the archive knows it: "1962", "July 1962", "Jul 14, 1962",
 * each with "c." when the date is approximate. Calendar dates, so no timezone
 * is involved (see `formatCalendarDate`).
 */
export const formatPartialDate = (
  value: string | null | undefined,
  precision: DatePrecision | null | undefined,
  circa?: boolean | null
): string => {
  if (!value) return '';
  let text: string;
  if (precision === 'year') {
    text = value.slice(0, 4);
  } else if (precision === 'month') {
    text = formatCalendarDate(value, { year: 'numeric', month: 'long' });
  } else {
    text = formatCalendarDate(value);
  }
  return circa ? `c. ${text}` : text;
};

/** "1951–1972", from one service period. */
export const formatPeriod = (period: {
  start_date: string | null;
  start_precision: DatePrecision;
  start_circa: boolean;
  end_date: string | null;
  end_precision: DatePrecision;
  end_circa: boolean;
  is_ongoing: boolean;
}): string => {
  const start = formatPartialDate(period.start_date, period.start_precision, period.start_circa) || '?';
  if (period.is_ongoing) return `${start} – present`;
  const end = formatPartialDate(period.end_date, period.end_precision, period.end_circa);
  return end ? `${start} – ${end}` : start;
};

// Mirrors ALLOWED_TAGS in backend/app/utils/markdown_render.py; change them
// together. The server is the authority and cleans what it renders; this is
// the second line, so HTML that somehow reached the page unclean cannot run.
const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'strong',
  'em',
  's',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'code',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];
const ALLOWED_ATTR = ['href'];
const ALLOWED_URI = /^(?:https?|mailto):/i;

let purifier: ReturnType<typeof DOMPurify> | null = null;

const getPurifier = () => {
  if (purifier) return purifier;
  const instance = DOMPurify(window);
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') node.setAttribute('rel', 'noopener noreferrer');
  });
  purifier = instance;
  return instance;
};

export const sanitizeArchiveHtml = (html: string): string =>
  getPurifier().sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP: ALLOWED_URI });
