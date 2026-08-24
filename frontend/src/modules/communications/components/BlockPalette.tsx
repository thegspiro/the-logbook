/**
 * Block Palette
 *
 * Seven ready-made pieces of a notice, inserted at the cursor. The point is
 * not typing speed — it is that a secretary writing a notice has no way to
 * know which classes the email shell styles, and a wrong one fails silently.
 * The palette is the sanctioned answer, so it is also the only one that has
 * to stay correct.
 */

import React from 'react';
import { AlertTriangle, Heading, LayoutTemplate, List, PenLine, SquareMousePointer, Table, Type } from 'lucide-react';
import { EMAIL_BLOCKS, type EmailBlock } from '../constants/blocks';

const BLOCK_ICONS: Record<EmailBlock['icon'], React.ElementType> = {
  heading: Heading,
  text: Type,
  table: Table,
  squareMousePointer: SquareMousePointer,
  alertTriangle: AlertTriangle,
  list: List,
  penLine: PenLine,
};

interface BlockPaletteProps {
  onInsert: (html: string) => void;
}

export const BlockPalette: React.FC<BlockPaletteProps> = ({ onInsert }) => (
  <div className="card-secondary">
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-theme-text-secondary flex items-center space-x-2 text-sm">
        <LayoutTemplate className="h-4 w-4" />
        <span>Blocks</span>
      </span>
      <span className="text-theme-text-muted text-xs">Click to insert at the cursor</span>
    </div>
    <div className="border-theme-surface-border flex flex-wrap gap-2 border-t px-4 pt-3 pb-3">
      {EMAIL_BLOCKS.map((block) => {
        const Icon = BLOCK_ICONS[block.icon];
        return (
          <button
            key={block.id}
            type="button"
            onClick={() => onInsert(block.html)}
            className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] transition-colors hover:border-red-500/40"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {block.label}
          </button>
        );
      })}
    </div>
  </div>
);

export default BlockPalette;
