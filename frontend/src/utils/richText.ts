/**
 * Rich text for minutes sections: the subset the editor produces, cleaned the
 * same way the server cleans it.
 *
 * The server is the authority — it sanitizes on every write and again when it
 * publishes — so this is the second line: it cleans what the editor loads and
 * what a page renders, so a value that somehow reached the database unclean
 * still cannot run in a member's browser. The allowlist below mirrors
 * `app/utils/rich_text.py`; change them together.
 */

import DOMPurify from 'dompurify';

export type TextFormat = 'text' | 'html';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a'];
const ALLOWED_ATTR = ['href'];
const ALLOWED_URI = /^(?:https?|mailto):/i;

// A private instance, so the link hook below does not touch every other place
// the app sanitizes with the shared DOMPurify.
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

export const sanitizeRichText = (html: string): string =>
  getPurifier().sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
  });

/** The words in a piece of rich text, with no markup. */
export const richTextToPlain = (html: string): string => {
  const holder = document.createElement('div');
  holder.innerHTML = sanitizeRichText(html);
  return (holder.textContent ?? '').trim();
};

/**
 * Plain text as the rich editor should open it: blank lines separate
 * paragraphs and single line breaks stay line breaks. Escaped, so text such as
 * `a < b` is shown as typed and never read as markup.
 */
export const plainTextToHtml = (text: string): string => {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
};

interface HasContent {
  content: string;
  format?: TextFormat | undefined;
}

/** True when a section holds no words (an empty `<p></p>` is blank). */
export const sectionIsBlank = (section: HasContent): boolean =>
  section.format === 'html' ? richTextToPlain(section.content) === '' : section.content.trim() === '';
