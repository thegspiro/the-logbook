/**
 * Button icon layout integrity
 *
 * The shared fills (`btn-primary`, `btn-secondary`, `btn-success`, `btn-info`,
 * `btn-warning`) switch to `inline-flex` only inside their phone-or-touch media
 * query, where they grow to the 44px minimum. At desktop widths with a mouse
 * they are plain blocks, and Tailwind's preflight makes every `<svg>` a block —
 * so an icon written beside a label sits on its own line above it. Nothing
 * catches it in review because a phone, and every touch screen, renders the
 * button correctly. Thirty-two call sites had drifted into it by 2026-10-14.
 *
 * A button whose fill carries an icon AND a label therefore states its own
 * layout: `inline-flex items-center gap-2` (or `flex`, or a size utility —
 * `btn-sm`, `btn-md`, `btn-lg`, `btn-icon*` — all of which are flex). An icon
 * that is itself `inline`, or that only ever replaces the label (a spinner in
 * a ternary with the text), lays out correctly and is not flagged.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const FILLS = new Set(['btn-primary', 'btn-secondary', 'btn-success', 'btn-info', 'btn-warning']);
const LAYOUT = new Set([
  'btn-sm',
  'btn-md',
  'btn-lg',
  'btn-icon',
  'btn-icon-sm',
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'hidden',
  'contents',
]);
const OPENING = /<(button|Link|NavLink|a|label)\b/g;
const CLASS_NAME = /className=(?:"([^"]*)"|\{\s*'([^']*)'\s*\}|\{\s*"([^"]*)"\s*\})/;
/** A sized component — an icon — that has not been made inline. */
const BLOCK_ICON = /<[A-Z]\w*\b[^>]*?className="(?![^"]*(?<![\w:-])inline(?![\w-]))[^"]*(?<![\w-])(?:h|w|size)-\d/;

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

/** Index of the `>` closing the tag that opens at `from`, skipping braces and strings. */
const tagEnd = (source: string, from: number): number => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
};

/** The `{…}` expressions directly inside `inner`, and the text between them. */
const splitChildren = (inner: string): { text: string; expressions: string[] } => {
  let text = '';
  const expressions: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of inner) {
    if (c === '{') {
      if (depth > 0) current += c;
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        expressions.push(current);
        current = '';
      } else current += c;
    } else if (depth > 0) current += c;
    else text += c;
  }
  return { text, expressions };
};

/** Whether the element's children hold a block-level icon beside a label. */
const iconBesideLabel = (inner: string): boolean => {
  if (!BLOCK_ICON.test(inner)) return false;
  const { text, expressions } = splitChildren(inner);
  const plainText = text.replace(/<[^>]*>/g, '').trim();
  // An expression holding no element is text: `{skill.active ? 'Deactivate' : 'Reactivate'}`.
  const textExpression = expressions.some((expression) => !/</.test(expression) && !/^\s*\/\*/.test(expression));
  // An icon in a nested wrapper is laid out by that wrapper, not by the button.
  const topLevelIcon =
    BLOCK_ICON.test(text) ||
    expressions.some((expression) => BLOCK_ICON.test(expression) && !/<(?:span|div)\b/.test(expression));
  return topLevelIcon && (plainText !== '' || textExpression);
};

const findOffenders = (source: string): number[] => {
  const lines: number[] = [];
  for (const match of source.matchAll(OPENING)) {
    const start = match.index;
    const end = tagEnd(source, start + match[0].length);
    if (end < 0 || source[end - 1] === '/') continue;
    const classMatch = CLASS_NAME.exec(source.slice(start, end + 1));
    if (!classMatch) continue;
    const classes = (classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? '').split(/\s+/);
    if (!classes.some((c) => FILLS.has(c))) continue;
    if (classes.some((c) => LAYOUT.has(c) || /^(?:[\w-]+:)+(?:inline-)?flex$/.test(c))) continue;
    const close = source.indexOf(`</${match[1]}>`, end);
    if (close < 0) continue;
    if (iconBesideLabel(source.slice(end + 1, close))) lines.push(source.slice(0, start).split('\n').length);
  }
  return lines;
};

describe('button icon layout integrity', () => {
  it('lays out every filled button that pairs an icon with a label', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC)) {
      for (const line of findOffenders(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(SRC, file)}:${line}`);
      }
    }
    expect(
      offenders,
      'Add `inline-flex items-center gap-2` — at desktop widths a btn-* fill is a block and its icon sits above the label'
    ).toEqual([]);
  });

  it('detects the shapes it exists to forbid', () => {
    for (const bad of [
      '<button className="btn-primary">\n  <Plus className="h-4 w-4" />\n  Add\n</button>',
      '<Link to="/x" className="btn-secondary mt-2"><Pencil className="h-4 w-4" /> Edit</Link>',
      '<button className="btn-primary">\n  {saving && <Loader2 className="h-4 w-4 animate-spin" />}\n  Save\n</button>',
      '<button className="btn-secondary">\n  <Power className="h-4 w-4" />\n  {on ? \'Off\' : \'On\'}\n</button>',
    ]) {
      expect(findOffenders(bad), bad).toEqual([1]);
    }
  });

  it('leaves the shapes that already lay out correctly alone', () => {
    for (const ok of [
      '<button className="btn-primary inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Add</button>',
      '<button className="btn-primary btn-md"><Plus className="h-4 w-4" /> Add</button>',
      '<button className="btn-primary px-6">Next <ArrowRight className="ml-1 inline h-4 w-4" /></button>',
      '<button className="btn-primary">{busy ? <Loader2 className="h-4 w-4" /> : \'Save\'}</button>',
      '<button className="btn-primary">{busy ? (<span className="flex items-center gap-2"><Loader2 className="h-4 w-4" />Saving</span>) : \'Save\'}</button>',
      '<button className="btn-primary">Save</button>',
      '<button className="btn-icon"><X className="h-4 w-4" /></button>',
    ]) {
      expect(findOffenders(ok), ok).toEqual([]);
    }
  });
});
