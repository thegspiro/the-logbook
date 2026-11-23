import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MediaSummary } from '../types';
import { blocksForSave, photoBlock, textBlock, type FormBlock } from '../utils/articleCatalogue';

const mockListMedia = vi.fn();
vi.mock('../services/api', () => ({
  historyMediaService: { listMedia: (...args: unknown[]) => mockListMedia(...args) as unknown },
  mediaFileUrl: (id: string, which: string) => `/api/v1/history/media/${id}/${which}`,
}));

import { ArticleBlocksEditor } from './ArticleBlocksEditor';

const photo = (id: string, title: string): MediaSummary => ({
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

let latest: FormBlock[] = [];

const Harness: React.FC<{ initial: FormBlock[] }> = ({ initial }) => {
  const [blocks, setBlocks] = useState(initial);
  latest = blocks;
  return (
    <ArticleBlocksEditor
      value={blocks}
      onChange={(next) => {
        latest = next;
        setBlocks(next);
      }}
    />
  );
};

const kinds = () => latest.map((b) => (b.kind === 'text' ? `text:${b.html}` : `photo:${b.media_id ?? ''}`));

describe('ArticleBlocksEditor', () => {
  beforeEach(() => {
    mockListMedia.mockReset();
    mockListMedia.mockResolvedValue({ items: [photo('m1', 'The ruins')], total: 1 });
    latest = [];
  });

  it('adds a photo found in the archive below a block, searching only photos', async () => {
    render(<Harness initial={[textBlock('<p>First</p>'), textBlock('<p>Last</p>')]} />);
    const [firstBlock] = screen.getAllByRole('listitem');
    await userEvent.click(within(firstBlock as HTMLElement).getByRole('button', { name: 'Add photo below' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Choose The ruins' }));
    expect(kinds()).toEqual(['text:<p>First</p>', 'photo:m1', 'text:<p>Last</p>']);
    expect(mockListMedia).toHaveBeenCalledWith(expect.objectContaining({ kind: 'photo' }));
  });

  it('gives a photo its caption and width', async () => {
    render(<Harness initial={[photoBlock(photo('m1', 'The ruins'))]} />);
    await userEvent.type(screen.getByLabelText('Caption'), 'Next morning');
    await userEvent.selectOptions(screen.getByLabelText('Width'), 'half');
    expect(blocksForSave(latest)).toEqual([{ kind: 'photo', media_id: 'm1', caption: 'Next morning', size: 'half' }]);
  });

  it('moves and removes blocks, and cannot move past either end', async () => {
    render(<Harness initial={[textBlock('<p>a</p>'), textBlock('<p>b</p>'), textBlock('<p>c</p>')]} />);
    expect(screen.getByRole('button', { name: 'Move block 1 of 3 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move block 3 of 3 down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move block 3 of 3 up' }));
    expect(kinds()).toEqual(['text:<p>a</p>', 'text:<p>c</p>', 'text:<p>b</p>']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove block 1 of 3' }));
    expect(kinds()).toEqual(['text:<p>c</p>', 'text:<p>b</p>']);
  });

  it('adds a text block at the end', async () => {
    render(<Harness initial={[photoBlock(photo('m1', 'The ruins'))]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add text at the end' }));
    expect(kinds()).toEqual(['photo:m1', 'text:']);
    expect(screen.getByRole('textbox', { name: 'Text, block 2 of 2' })).toBeInTheDocument();
  });

  it('shows a photo that is gone as a gap to fix', () => {
    render(<Harness initial={[{ ...photoBlock(photo('m1', 'The ruins')), media: null, media_id: null }]} />);
    expect(screen.getByText('This photo is no longer in the archive')).toBeInTheDocument();
  });
});
