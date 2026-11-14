/**
 * The formatting a department's own legal text may use (owner decision W54-5,
 * 2026-11-01): headings and lists, and nothing else.
 *
 *   ## Heading          (`#` and `##` are section headings, `###` a subheading)
 *   - item  or  * item  (a bulleted list; consecutive lines form one list)
 *   1. item or  1) item (a numbered list)
 *
 * Blank lines separate paragraphs; a single line break inside a paragraph is
 * kept. An indented line directly under a list item continues that item.
 *
 * Safety is by construction rather than by sanitizing. The parser returns plain
 * data — block kinds and strings — and the renderer puts every string into the
 * page as a React text node, so `<script>`, an `onerror=` attribute or a
 * `javascript:` link is shown as the characters typed and never interpreted.
 * There is deliberately no inline syntax (no links, no emphasis, no HTML): a
 * link is the one formatting feature that can carry a payload, and the public
 * page is the one page every visitor can reach. The only value taken from the
 * text into an attribute is a numbered list's starting number, parsed as an
 * integer.
 *
 * Not `utils/simpleMarkdown` (event descriptions): that renders links, bold
 * and italics and has no headings or numbered lists — the opposite of the
 * subset decided here. No sanitizer (`nh3` serves the backend's rich-text
 * minutes) is needed either, because no HTML is ever produced from the text.
 */

export type LegalMarkupBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; start: number; items: string[] };

const HEADING = /^(#{1,3})[ \t]+(\S.*?)[ \t]*#*[ \t]*$/;
const BULLET = /^[ \t]{0,3}[-*•][ \t]+(\S.*)$/;
const NUMBERED = /^[ \t]{0,3}(\d{1,6})[.)][ \t]+(\S.*)$/;
const CONTINUATION = /^[ \t]{2,}(\S.*)$/;

/** Parse department legal text into headings, paragraphs and lists. */
export const parseLegalMarkup = (text: string): LegalMarkupBlock[] => {
  const blocks: LegalMarkupBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<LegalMarkupBlock, { kind: 'ul' | 'ol' }> | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
    list = null;
  };

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/[ \t]+$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const hashes = heading[1] ?? '#';
      blocks.push({ kind: 'heading', level: hashes.length === 3 ? 3 : 2, text: heading[2] ?? '' });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (list?.kind !== 'ul') {
        flush();
        list = { kind: 'ul', items: [] };
        blocks.push(list);
      }
      list.items.push(bullet[1] ?? '');
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      if (list?.kind !== 'ol') {
        flush();
        list = { kind: 'ol', start: Number.parseInt(numbered[1] ?? '1', 10), items: [] };
        blocks.push(list);
      }
      list.items.push(numbered[2] ?? '');
      continue;
    }

    const continuation = list ? CONTINUATION.exec(line) : null;
    if (list && continuation) {
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ''} ${continuation[1] ?? ''}`;
      continue;
    }

    if (list) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
};
