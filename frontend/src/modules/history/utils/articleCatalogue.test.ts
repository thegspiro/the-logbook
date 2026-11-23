import { describe, expect, it } from 'vitest';
import type { ArticleFullView, MediaSummary } from '../types';
import {
  articleFileName,
  articleForCreate,
  articleFormFrom,
  articleForUpdate,
  blocksForSave,
  emptyArticleForm,
  moveBlock,
  photoBlock,
  textBlock,
  type ArticleForm,
} from './articleCatalogue';

const photo = (id: string, title = 'Parade'): MediaSummary => ({
  id,
  kind: 'photo',
  title,
  taken_date: null,
  taken_date_precision: 'year',
  taken_date_circa: false,
  duration_seconds: null,
  has_thumbnail: true,
  publication_level: 'members',
});

const filled = (overrides: Partial<ArticleForm> = {}): ArticleForm => ({
  ...emptyArticleForm(),
  title: '  The mill fire ',
  blocks: [textBlock('<p>It began at night.</p>'), photoBlock(photo('m1'))],
  members: [{ member_id: 'p1', display_name: 'Smith' }],
  events: [{ id: 'e1', label: 'Mill fire' }],
  apparatus: [{ id: 'a1', label: 'Engine 1' }],
  documents: [{ id: 'd1', label: 'Report' }],
  ...overrides,
});

describe('blocksForSave', () => {
  it('drops an empty text block and a photo that is gone, and keeps the order', () => {
    const blocks = [
      photoBlock(photo('m1')),
      textBlock('<p></p>'),
      textBlock('<p>Words</p>'),
      { ...photoBlock(photo('m2')), media: null, media_id: null },
    ];
    expect(blocksForSave(blocks)).toEqual([
      { kind: 'photo', media_id: 'm1', caption: null, size: 'full' },
      { kind: 'text', html: '<p>Words</p>' },
    ]);
  });

  it('sends a trimmed caption and the chosen width', () => {
    const block = { ...photoBlock(photo('m1')), caption: '  The ruins ', size: 'half' as const };
    expect(blocksForSave([block])).toEqual([{ kind: 'photo', media_id: 'm1', caption: 'The ruins', size: 'half' }]);
  });
});

describe('moveBlock', () => {
  it('moves a block one place and leaves the ends alone', () => {
    const [a, b, c] = [textBlock('<p>a</p>'), textBlock('<p>b</p>'), textBlock('<p>c</p>')];
    expect(moveBlock([a, b, c], 2, -1)).toEqual([a, c, b]);
    expect(moveBlock([a, b, c], 0, 1)).toEqual([b, a, c]);
    const same = [a, b, c];
    expect(moveBlock(same, 0, -1)).toBe(same);
    expect(moveBlock(same, 2, 1)).toBe(same);
  });
});

describe('articleForCreate', () => {
  it('omits blanks, leaves the byline to the server, and sends every link set', () => {
    expect(articleForCreate(filled({ citations: ['  ', 'The Courier, 1911'] }))).toEqual({
      title: 'The mill fire',
      subtitle: undefined,
      byline: undefined,
      summary: undefined,
      cover_media_id: undefined,
      research_notes: undefined,
      citations: ['The Courier, 1911'],
      blocks: [
        { kind: 'text', html: '<p>It began at night.</p>' },
        { kind: 'photo', media_id: 'm1', caption: null, size: 'full' },
      ],
      member_ids: ['p1'],
      event_ids: ['e1'],
      apparatus_ids: ['a1'],
      document_ids: ['d1'],
    });
  });
});

describe('articleForUpdate', () => {
  it('sends a cleared field as null and an emptied set as an empty list', () => {
    const payload = articleForUpdate(
      filled({ members: [], events: [], apparatus: [], documents: [], citations: [], cover: null })
    );
    expect(payload).toMatchObject({
      subtitle: null,
      byline: null,
      summary: null,
      cover_media_id: null,
      research_notes: null,
      citations: null,
      member_ids: [],
      event_ids: [],
      apparatus_ids: [],
      document_ids: [],
    });
    expect(payload.blocks).toHaveLength(2);
  });
});

describe('articleFormFrom', () => {
  it('fills the form from the server, keeping a photo that is gone as a gap', () => {
    const item = {
      id: 'ar1',
      view: 'full',
      title: 'The mill fire',
      subtitle: null,
      byline: 'Hannah',
      summary: null,
      cover: photo('c1', 'Cover'),
      cover_media_id: 'c1',
      citations: ['A book'],
      publication_level: 'draft',
      updated_at: '2026-11-22T12:00:00Z',
      blocks: [
        { id: 'b1', kind: 'text', html: '<p>Hi</p>', media: null, caption: null, size: 'full' },
        { id: 'b2', kind: 'photo', html: null, media: null, media_id: null, caption: 'Gone', size: 'half' },
      ],
      members: [{ member_id: 'p1', display_name: 'Smith' }],
      events: [],
      apparatus: [{ apparatus_id: 'a1', name: 'Engine 1' }],
      documents: [],
      sources: [],
      research_notes: 'Notes',
    } as unknown as ArticleFullView;
    const form = articleFormFrom(item);
    expect(form.byline).toBe('Hannah');
    expect(form.cover?.id).toBe('c1');
    expect(form.blocks.map((b) => b.kind)).toEqual(['text', 'photo']);
    expect(form.blocks[1]).toMatchObject({ media: null, media_id: null, caption: 'Gone', size: 'half' });
    expect(form.apparatus).toEqual([{ id: 'a1', label: 'Engine 1' }]);
    expect(blocksForSave(form.blocks)).toEqual([{ kind: 'text', html: '<p>Hi</p>' }]);
  });
});

describe('articleFileName', () => {
  it('names the file after the title, safely', () => {
    expect(articleFileName('The "Big" Fire / 1911', 'pdf')).toBe('the_big_fire_1911.pdf');
    expect(articleFileName('Feu à l’usine', 'docx')).toBe('feu_à_l_usine.docx');
    expect(articleFileName('///', 'pdf')).toBe('article.pdf');
  });
});
