/**
 * The form an article is written with, and the two payloads built from it: a
 * create omits blanks, an update sends a cleared field as null (CLAUDE.md
 * pitfall #1). Both send the whole body and every link set the form owns, so
 * a removed block, person, event, apparatus or document is removed.
 */
import { blankToNull } from '../../../utils/formValues';
import { richTextToPlain } from '../../../utils/richText';
import type {
  ArticleBlockWrite,
  ArticleCreate,
  ArticleExportFormat,
  ArticleFullView,
  ArticleLinks,
  ArticlePhotoSize,
  ArticleUpdate,
  MediaSummary,
} from '../types';
import type { LinkedRecord } from './eventCatalogue';

/** One block as the editor holds it. `key` identifies the block on screen
 * (and keys its rich-text editor), never on the server. */
export type FormBlock =
  | { key: string; kind: 'text'; html: string }
  | {
      key: string;
      kind: 'photo';
      /** Null when the photo was deleted or withdrawn since it was chosen. */
      media: MediaSummary | null;
      media_id: string | null;
      caption: string;
      size: ArticlePhotoSize;
    };

export interface ArticleForm {
  title: string;
  subtitle: string;
  byline: string;
  summary: string;
  cover: MediaSummary | null;
  research_notes: string;
  blocks: FormBlock[];
  citations: string[];
  members: { member_id: string; display_name: string }[];
  events: LinkedRecord[];
  apparatus: LinkedRecord[];
  documents: LinkedRecord[];
}

let nextKey = 0;
export const newBlockKey = (): string => {
  nextKey += 1;
  return `block-${nextKey}`;
};

export const textBlock = (html = ''): FormBlock => ({ key: newBlockKey(), kind: 'text', html });

export const photoBlock = (media: MediaSummary): FormBlock => ({
  key: newBlockKey(),
  kind: 'photo',
  media,
  media_id: media.id,
  caption: '',
  size: 'full',
});

/** A new article starts with one empty text block to write in. Its byline is
 * left for the server to fill with the writer's name. */
export const emptyArticleForm = (): ArticleForm => ({
  title: '',
  subtitle: '',
  byline: '',
  summary: '',
  cover: null,
  research_notes: '',
  blocks: [textBlock()],
  citations: [],
  members: [],
  events: [],
  apparatus: [],
  documents: [],
});

/** Move one block up (-1) or down (+1); out of range leaves the list alone. */
export const moveBlock = (blocks: FormBlock[], index: number, step: -1 | 1): FormBlock[] => {
  const target = index + step;
  if (index < 0 || target < 0 || target >= blocks.length) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  if (moved) next.splice(target, 0, moved);
  return next;
};

/** The body to send. An empty text block is left out (the server would drop
 * it anyway), and so is a photo block whose photo is gone: there is nothing
 * left to send for it. */
export const blocksForSave = (blocks: FormBlock[]): ArticleBlockWrite[] =>
  blocks.flatMap((block): ArticleBlockWrite[] => {
    if (block.kind === 'text') {
      return richTextToPlain(block.html).trim() ? [{ kind: 'text', html: block.html }] : [];
    }
    if (!block.media_id) return [];
    return [
      {
        kind: 'photo',
        media_id: block.media_id,
        caption: block.caption.trim() || null,
        size: block.size,
      },
    ];
  });

const citationsForSave = (citations: string[]): string[] => citations.map((c) => c.trim()).filter(Boolean);

const links = (form: ArticleForm): Required<Omit<ArticleLinks, 'blocks'>> => ({
  member_ids: form.members.map((m) => m.member_id),
  event_ids: form.events.map((e) => e.id),
  apparatus_ids: form.apparatus.map((a) => a.id),
  document_ids: form.documents.map((d) => d.id),
});

export const articleForCreate = (form: ArticleForm): ArticleCreate => {
  const citations = citationsForSave(form.citations);
  return {
    title: form.title.trim(),
    subtitle: form.subtitle.trim() || undefined,
    // Left out, the server writes the writer's name.
    byline: form.byline.trim() || undefined,
    summary: form.summary.trim() || undefined,
    cover_media_id: form.cover?.id || undefined,
    research_notes: form.research_notes.trim() || undefined,
    citations: citations.length ? citations : undefined,
    blocks: blocksForSave(form.blocks),
    ...links(form),
  };
};

export const articleForUpdate = (form: ArticleForm): ArticleUpdate => {
  const citations = citationsForSave(form.citations);
  return {
    title: form.title.trim(),
    subtitle: blankToNull(form.subtitle),
    byline: blankToNull(form.byline),
    summary: blankToNull(form.summary),
    cover_media_id: form.cover?.id ?? null,
    research_notes: blankToNull(form.research_notes),
    citations: citations.length ? citations : null,
    blocks: blocksForSave(form.blocks),
    ...links(form),
  };
};

/** The edit form, filled from an article as the server sent it. */
export const articleFormFrom = (item: ArticleFullView): ArticleForm => ({
  title: item.title,
  subtitle: item.subtitle ?? '',
  byline: item.byline ?? '',
  summary: item.summary ?? '',
  cover: item.cover,
  research_notes: item.research_notes ?? '',
  blocks: item.blocks.map((block): FormBlock =>
    block.kind === 'text'
      ? { key: newBlockKey(), kind: 'text', html: block.html ?? '' }
      : {
          key: newBlockKey(),
          kind: 'photo',
          media: block.media,
          media_id: block.media?.id ?? null,
          caption: block.caption ?? '',
          size: block.size,
        }
  ),
  citations: [...item.citations],
  members: item.members.map((m) => ({ member_id: m.member_id, display_name: m.display_name })),
  events: item.events.map((e) => ({ id: e.id, label: e.title })),
  apparatus: item.apparatus.map((a) => ({ id: a.apparatus_id, label: a.name })),
  documents: item.documents.map((d) => ({ id: d.id, label: d.title })),
});

/** What the saved file is called: the title in lower case, words joined by
 * underscores, as the server names it. */
export const articleFileName = (title: string, format: ArticleExportFormat): string => {
  const stem =
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'article';
  return `${stem}.${format}`;
};
