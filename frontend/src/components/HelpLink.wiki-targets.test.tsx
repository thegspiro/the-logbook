/**
 * Every built-in help topic opens a wiki page that exists, at a heading that
 * exists.
 *
 * `members` pointed at `Module-Training#membership` for months: the Training
 * page has no such heading, and nothing noticed because the docs link check
 * reads Markdown, not this map. Wiki pages are split and their headings
 * renamed as the docs are reorganised, so the map is checked against the
 * repository's own wiki/ tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HelpLink } from './HelpLink';

const WIKI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../wiki');
const WIKI_BASE = 'https://github.com/thegspiro/the-logbook/wiki';

// Built by wiki/setup-wiki.sh at publish time, so they have no file here
// (mirrors WIKI_GENERATED_PAGES in scripts/check_docs_links.py).
const GENERATED_PAGES = new Set(['Troubleshooting', 'Error-Codes']);

const TOPICS = ['dashboard', 'organization-setup', 'members', 'elections', 'events', 'reports', 'training', 'settings'];

// GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens.
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-');

const anchorsOf = (page: string) =>
  new Set(
    fs
      .readFileSync(path.join(WIKI_DIR, `${page}.md`), 'utf8')
      .split('\n')
      .map((line) => /^#{1,6} (.*)$/.exec(line)?.[1]?.trim())
      .filter((heading): heading is string => heading !== undefined)
      .map(slug)
  );

// What is wrong with a help URL, or null when it resolves. Kept out of the test
// body so the test itself asserts once, unconditionally.
const unresolvedTarget = (url: string): string | null => {
  if (!url.startsWith(`${WIKI_BASE}/`)) return `${url} is not on the wiki`;
  const [page = '', anchor] = url.slice(WIKI_BASE.length + 1).split('#');
  if (GENERATED_PAGES.has(page)) return null;
  if (!fs.existsSync(path.join(WIKI_DIR, `${page}.md`))) return `wiki/${page}.md does not exist`;
  if (anchor !== undefined && !anchorsOf(page).has(anchor)) return `wiki/${page}.md has no heading #${anchor}`;
  return null;
};

const openedUrlFor = async (topic: string) => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  render(<HelpLink topic={topic} />);
  await userEvent.click(screen.getByRole('button', { name: `Help: ${topic}` }));
  return String(open.mock.calls[0]?.[0] ?? '');
};

describe('HelpLink topic URLs resolve to the wiki', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(TOPICS)('%s opens an existing wiki page and heading', async (topic) => {
    expect(unresolvedTarget(await openedUrlFor(topic))).toBeNull();
  });
});
