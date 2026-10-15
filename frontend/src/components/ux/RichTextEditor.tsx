/**
 * Rich-text editor for minutes sections and outline starting text (TipTap).
 *
 * Offers exactly what the server stores and the PDF can print — bold, italic,
 * underline, two heading levels, bulleted and numbered lists, block quotes and
 * links — and nothing else, so what a secretary sees is what is kept. The
 * extension set below and the allowlists in `utils/richText.ts` and
 * `app/utils/rich_text.py` are one decision; change them together.
 *
 * `value` seeds the editor; it is not a controlled input. A caller that needs a
 * different document mounts a fresh editor with a different `key`.
 */

import React, { useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Heading2, Heading3, Italic, Link2, List, ListOrdered, Quote, Underline } from 'lucide-react';
import { sanitizeRichText } from '../../utils/richText';

interface RichTextEditorProps {
  id: string;
  /** The starting document, as the HTML subset. */
  value: string;
  onChange: (html: string) => void;
  /** The accessible name of the editing area. */
  label: string;
  className?: string;
}

const ALLOWED_LINK = /^(?:https?:\/\/|mailto:)/i;

const withProtocol = (raw: string): string => {
  const url = raw.trim();
  if (!url) return '';
  if (ALLOWED_LINK.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return '';
  return `https://${url}`;
};

export const RichTextEditor: React.FC<RichTextEditorProps> = ({ id, value, onChange, label, className = '' }) => {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: false, protocols: ['mailto'] },
      }),
    ],
    content: sanitizeRichText(value),
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        class: 'form-input rich-text min-h-32',
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.isEmpty ? '' : current.getHTML()),
  });

  const active = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor?.isActive('bold') ?? false,
      italic: ctx.editor?.isActive('italic') ?? false,
      underline: ctx.editor?.isActive('underline') ?? false,
      h2: ctx.editor?.isActive('heading', { level: 2 }) ?? false,
      h3: ctx.editor?.isActive('heading', { level: 3 }) ?? false,
      bullets: ctx.editor?.isActive('bulletList') ?? false,
      numbers: ctx.editor?.isActive('orderedList') ?? false,
      quote: ctx.editor?.isActive('blockquote') ?? false,
      link: ctx.editor?.isActive('link') ?? false,
    }),
  });

  if (!editor) return null;

  const openLink = () => {
    setLinkUrl((editor.getAttributes('link').href as string | undefined) ?? '');
    setLinkError(null);
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = withProtocol(linkUrl);
    if (!url) {
      setLinkError('Enter a web address (https://…) or an email address (mailto:…).');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    setLinkOpen(false);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  };

  const tools: { name: string; icon: React.ReactNode; on: boolean; run: () => void }[] = [
    {
      name: 'Bold',
      icon: <Bold className="h-4 w-4" aria-hidden="true" />,
      on: active.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: 'Italic',
      icon: <Italic className="h-4 w-4" aria-hidden="true" />,
      on: active.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: 'Underline',
      icon: <Underline className="h-4 w-4" aria-hidden="true" />,
      on: active.underline,
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      name: 'Heading',
      icon: <Heading2 className="h-4 w-4" aria-hidden="true" />,
      on: active.h2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      name: 'Subheading',
      icon: <Heading3 className="h-4 w-4" aria-hidden="true" />,
      on: active.h3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      name: 'Bulleted list',
      icon: <List className="h-4 w-4" aria-hidden="true" />,
      on: active.bullets,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: 'Numbered list',
      icon: <ListOrdered className="h-4 w-4" aria-hidden="true" />,
      on: active.numbers,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      name: 'Quote',
      icon: <Quote className="h-4 w-4" aria-hidden="true" />,
      on: active.quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      name: 'Link',
      icon: <Link2 className="h-4 w-4" aria-hidden="true" />,
      on: active.link,
      run: openLink,
    },
  ];

  return (
    <div className={className}>
      <div role="toolbar" aria-label={`Formatting for ${label}`} className="mb-1 flex flex-wrap items-center gap-1">
        {tools.map((tool) => (
          <button
            key={tool.name}
            type="button"
            onClick={tool.run}
            aria-label={tool.name}
            aria-pressed={tool.on}
            title={tool.name}
            className={`btn-icon ${tool.on ? 'bg-theme-surface-hover text-theme-text-primary' : 'text-theme-text-secondary'}`}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      {linkOpen && (
        <div className="border-theme-surface-border mb-2 flex flex-wrap items-end gap-2 rounded-lg border p-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-link`} className="form-label">
              Link address
            </label>
            <input
              id={`${id}-link`}
              type="text"
              inputMode="url"
              value={linkUrl}
              onChange={(e) => {
                setLinkUrl(e.target.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                }
              }}
              placeholder="https://"
              className="form-input"
            />
            {linkError && (
              <p className="alert-danger mt-1 text-sm" role="alert">
                {linkError}
              </p>
            )}
          </div>
          <button type="button" onClick={applyLink} className="btn-primary touch:min-h-11 text-sm">
            Apply link
          </button>
          {active.link && (
            <button type="button" onClick={removeLink} className="btn-secondary touch:min-h-11 text-sm">
              Remove link
            </button>
          )}
          <button type="button" onClick={() => setLinkOpen(false)} className="btn-secondary touch:min-h-11 text-sm">
            Cancel
          </button>
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  );
};

export default RichTextEditor;
