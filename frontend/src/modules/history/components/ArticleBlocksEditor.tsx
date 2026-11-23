/**
 * An article's body, block by block: text in the minutes' rich-text editor,
 * or an archive photo with its caption and width. Blocks are added below any
 * block or at the end, moved up and down, and removed.
 *
 * Each text block's editor is keyed by the block, so moving a block moves its
 * editor with it rather than handing its words to a neighbour.
 */
import React, { useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Trash2, Type } from 'lucide-react';
import { RichTextEditor } from '../../../components/ux/RichTextEditor';
import { mediaFileUrl } from '../services/api';
import type { ArticlePhotoSize, MediaSummary } from '../types';
import { moveBlock, photoBlock, textBlock, type FormBlock } from '../utils/articleCatalogue';
import { ArchivePhotoPicker } from './ArchivePhotoPicker';

interface ArticleBlocksEditorProps {
  value: FormBlock[];
  onChange: (next: FormBlock[]) => void;
  disabled?: boolean;
}

const SIZE_LABELS: Record<ArticlePhotoSize, string> = { full: 'Full width', half: 'Half width' };

/** The place a new block goes: after the block at this index, or -1 for the
 * end. */
type InsertAt = number;

export const ArticleBlocksEditor: React.FC<ArticleBlocksEditorProps> = ({ value, onChange, disabled = false }) => {
  const [pickingAt, setPickingAt] = useState<InsertAt | null>(null);

  const insert = (at: InsertAt, block: FormBlock) => {
    const index = at < 0 ? value.length : at + 1;
    onChange([...value.slice(0, index), block, ...value.slice(index)]);
  };
  const replace = (key: string, next: FormBlock) => onChange(value.map((b) => (b.key === key ? next : b)));
  const remove = (key: string) => onChange(value.filter((b) => b.key !== key));

  const addRow = (at: InsertAt, where: string) => (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => insert(at, textBlock())}
        disabled={disabled}
        className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm"
      >
        <Type className="h-4 w-4" aria-hidden="true" />
        Add text{where}
      </button>
      <button
        type="button"
        onClick={() => setPickingAt(at)}
        disabled={disabled}
        className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm"
      >
        <ImagePlus className="h-4 w-4" aria-hidden="true" />
        Add photo{where}
      </button>
    </div>
  );

  const picker = (at: InsertAt) =>
    pickingAt === at && (
      <ArchivePhotoPicker
        label="Find a photo to add"
        disabled={disabled}
        onCancel={() => setPickingAt(null)}
        onPick={(media: MediaSummary) => {
          insert(at, photoBlock(media));
          setPickingAt(null);
        }}
      />
    );

  return (
    <div className="space-y-4">
      {value.length === 0 && (
        <p className="text-theme-text-secondary text-sm">The article has no body yet. Add text or a photo.</p>
      )}
      <ol className="space-y-4" aria-label="Article body">
        {value.map((block, index) => {
          const position = `block ${index + 1} of ${value.length}`;
          return (
            <li key={block.key} className="card-secondary space-y-3 rounded-md p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-theme-text-secondary text-xs font-medium tracking-wide uppercase">
                  {block.kind === 'text' ? 'Text' : 'Photo'} · {index + 1}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn-icon touch-target-phone"
                    aria-label={`Move ${position} up`}
                    disabled={disabled || index === 0}
                    onClick={() => onChange(moveBlock(value, index, -1))}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon touch-target-phone"
                    aria-label={`Move ${position} down`}
                    disabled={disabled || index === value.length - 1}
                    onClick={() => onChange(moveBlock(value, index, 1))}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon touch-target-phone"
                    aria-label={`Remove ${position}`}
                    disabled={disabled}
                    onClick={() => remove(block.key)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {block.kind === 'text' ? (
                <RichTextEditor
                  key={block.key}
                  id={`article-${block.key}`}
                  label={`Text, ${position}`}
                  value={block.html}
                  onChange={(html) => replace(block.key, { ...block, html })}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                  <div className="bg-theme-surface-secondary flex aspect-square items-center justify-center overflow-hidden rounded-md">
                    {block.media ? (
                      <img
                        src={mediaFileUrl(block.media.id, block.media.has_thumbnail ? 'thumbnail' : 'view')}
                        alt={block.media.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-theme-text-secondary p-2 text-center text-sm">
                        This photo is no longer in the archive
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {block.media && <p className="text-theme-text-primary text-sm font-medium">{block.media.title}</p>}
                    <label className="block">
                      <span className="form-label">Caption</span>
                      <input
                        value={block.caption}
                        maxLength={500}
                        onChange={(e) => replace(block.key, { ...block, caption: e.target.value })}
                        className="form-input"
                        disabled={disabled}
                      />
                    </label>
                    <label className="block">
                      <span className="form-label">Width</span>
                      <select
                        value={block.size}
                        onChange={(e) =>
                          replace(block.key, { ...block, size: e.target.value === 'half' ? 'half' : 'full' })
                        }
                        className="form-input"
                        disabled={disabled}
                      >
                        {(Object.keys(SIZE_LABELS) as ArticlePhotoSize[]).map((size) => (
                          <option key={size} value={size}>
                            {SIZE_LABELS[size]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}

              {addRow(index, ' below')}
              {picker(index)}
            </li>
          );
        })}
      </ol>
      {addRow(-1, ' at the end')}
      {picker(-1)}
    </div>
  );
};
