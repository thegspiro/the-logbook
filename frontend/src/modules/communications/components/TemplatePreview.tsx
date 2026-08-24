/**
 * Template Preview Component
 *
 * Renders a live preview of an email template using an iframe for isolation.
 * Shows the rendered subject line and HTML body.
 * Includes a member dropdown so admins can preview with real member data.
 */

import React, { useRef, useEffect, useState } from 'react';
import { Monitor, Smartphone, Loader2, Eye, RefreshCw, Type, Users } from 'lucide-react';
import type { EmailTemplatePreview } from '../types';

type PreviewMode = 'desktop' | 'mobile' | 'text';

const PREVIEW_MODES: { mode: PreviewMode; icon: React.ElementType; title: string }[] = [
  { mode: 'desktop', icon: Monitor, title: 'Desktop preview' },
  { mode: 'mobile', icon: Smartphone, title: 'Mobile preview' },
  { mode: 'text', icon: Type, title: 'Plain-text preview' },
];

interface PreviewMember {
  id: string;
  full_name?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
  email?: string | undefined;
}

interface TemplatePreviewProps {
  preview: EmailTemplatePreview | null;
  isPreviewing: boolean;
  onRefresh: (memberId?: string) => void;
  members?: PreviewMember[] | undefined;
  isLoadingMembers?: boolean | undefined;
  /** Whether the pane is showing unsaved edits rather than the stored template. */
  isDirty?: boolean | undefined;
}

export const TemplatePreview: React.FC<TemplatePreviewProps> = ({
  preview,
  isPreviewing,
  onRefresh,
  members = [],
  isLoadingMembers = false,
  isDirty = false,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Three states, not a boolean pair. Plain text is the third: it is what a
  // recipient on a text-only client actually receives, it is the half of
  // every template nobody looks at, and it is the half that silently stops
  // matching the HTML the first time somebody edits one of them.
  const [viewport, setViewport] = useState<PreviewMode>('desktop');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');

  useEffect(() => {
    if (viewport === 'text') return;
    if (preview?.html_body && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(preview.html_body);
        doc.close();
      }
    }
  }, [preview?.html_body, viewport]);

  const handleMemberChange = (memberId: string) => {
    setSelectedMemberId(memberId);
    onRefresh(memberId || undefined);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
          <Eye className="h-5 w-5" />
          Live preview
          {/* Said out loud, because the pane now shows the draft: without
              this an admin reading a correct-looking preview has no way to
              tell whether anyone else would receive that email yet. */}
          {isDirty && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              Unsaved
            </span>
          )}
        </h3>
        <div className="flex items-center space-x-2">
          {/* Viewport toggle */}
          <div className="bg-theme-surface-secondary flex rounded-lg p-0.5">
            {PREVIEW_MODES.map(({ mode, icon: Icon, title }) => (
              <button
                key={mode}
                onClick={() => setViewport(mode)}
                aria-pressed={viewport === mode}
                className={`rounded-md p-1.5 transition-colors ${
                  viewport === mode ? 'bg-red-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
                }`}
                title={title}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{title}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => onRefresh(selectedMemberId || undefined)}
            disabled={isPreviewing}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
          >
            {isPreviewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Member selector */}
      <div className="flex items-center gap-2">
        <Users className="text-theme-text-muted h-4 w-4 shrink-0" />
        <select
          value={selectedMemberId}
          onChange={(e) => handleMemberChange(e.target.value)}
          disabled={isLoadingMembers}
          className="form-input flex-1 px-2 py-1.5 text-xs"
        >
          <option value="">Sample data (default)</option>
          {members.map((m) => {
            const name = m.full_name || [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || m.id;
            return (
              <option key={m.id} value={m.id}>
                {name}
              </option>
            );
          })}
        </select>
      </div>

      {/* Subject line */}
      {preview && (
        <div className="card-secondary px-4 py-2">
          <span className="text-theme-text-muted text-xs font-medium uppercase">Subject:</span>
          <p className="text-theme-text-primary mt-0.5 text-sm">{preview.subject}</p>
        </div>
      )}

      {/* Email body preview */}
      <div
        className={`card mx-auto overflow-hidden transition-all ${viewport === 'mobile' ? 'max-w-[375px]' : 'w-full'}`}
      >
        {isPreviewing && !preview ? (
          <div className="flex h-[600px] items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-red-500" />
              <p className="text-theme-text-muted text-sm">Loading preview...</p>
            </div>
          </div>
        ) : preview && viewport === 'text' ? (
          <pre className="text-theme-text-primary h-[600px] overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">
            {preview.text_body ||
              'This template has no plain-text body. Clients that cannot render HTML will show nothing.'}
          </pre>
        ) : preview ? (
          <iframe
            ref={iframeRef}
            title="Email template preview"
            className="w-full border-0"
            style={{ height: '600px' }}
            sandbox="allow-same-origin"
          />
        ) : (
          <div className="flex h-[600px] items-center justify-center">
            <div className="text-center">
              <Eye className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
              <p className="text-theme-text-muted text-sm">Click "Refresh" to generate a preview with sample data</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
