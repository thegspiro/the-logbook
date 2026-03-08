/**
 * Template Preview Component
 *
 * Renders a live preview of an email template using an iframe for isolation.
 * Shows the rendered subject line and HTML body.
 * Includes a member dropdown so admins can preview with real member data.
 */

import React, { useRef, useEffect, useState } from 'react';
import { Monitor, Smartphone, Loader2, Eye, RefreshCw, Users } from 'lucide-react';
import type { EmailTemplatePreview } from '../types';

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
}

export const TemplatePreview: React.FC<TemplatePreviewProps> = ({
  preview,
  isPreviewing,
  onRefresh,
  members = [],
  isLoadingMembers = false,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');

  useEffect(() => {
    if (preview?.html_body && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(preview.html_body);
        doc.close();
      }
    }
  }, [preview?.html_body]);

  const handleMemberChange = (memberId: string) => {
    setSelectedMemberId(memberId);
    onRefresh(memberId ?? undefined);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-theme-text-primary text-lg font-semibold flex items-center gap-2">
          <Eye className="w-5 h-5" />
          Preview
        </h3>
        <div className="flex items-center space-x-2">
          {/* Viewport toggle */}
          <div className="flex bg-theme-surface-secondary rounded-lg p-0.5">
            <button
              onClick={() => setViewport('desktop')}
              className={`p-1.5 rounded-md transition-colors ${
                viewport === 'desktop'
                  ? 'bg-orange-600 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
              title="Desktop preview"
            >
              <Monitor className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewport('mobile')}
              className={`p-1.5 rounded-md transition-colors ${
                viewport === 'mobile'
                  ? 'bg-orange-600 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
              title="Mobile preview"
            >
              <Smartphone className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={() => onRefresh(selectedMemberId ?? undefined)}
            disabled={isPreviewing}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-sm border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors disabled:opacity-50"
          >
            {isPreviewing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Member selector */}
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-theme-text-muted shrink-0" />
        <select
          value={selectedMemberId}
          onChange={(e) => handleMemberChange(e.target.value)}
          disabled={isLoadingMembers}
          className="flex-1 rounded-md border border-theme-surface-border bg-theme-surface px-2 py-1.5 text-xs text-theme-text-primary focus:border-theme-focus-ring focus:outline-hidden"
        >
          <option value="">Sample data (default)</option>
          {members.map((m) => {
            const name =
              m.full_name ||
              [m.first_name, m.last_name].filter(Boolean).join(' ') ||
              m.email ||
              m.id;
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
          <p className="text-theme-text-primary text-sm mt-0.5">{preview.subject}</p>
        </div>
      )}

      {/* Email body preview */}
      <div
        className={`bg-white rounded-lg border border-theme-surface-border overflow-hidden transition-all mx-auto ${
          viewport === 'mobile' ? 'max-w-[375px]' : 'w-full'
        }`}
      >
        {isPreviewing && !preview ? (
          <div className="flex items-center justify-center h-[600px]">
            <div className="text-center">
              <Loader2 className="w-8 h-8 text-orange-500 animate-spin mx-auto mb-2" />
              <p className="text-slate-500 text-sm">Loading preview...</p>
            </div>
          </div>
        ) : preview ? (
          <iframe
            ref={iframeRef}
            title="Email template preview"
            className="w-full border-0"
            style={{ height: '600px' }}
            sandbox="allow-same-origin"
          />
        ) : (
          <div className="flex items-center justify-center h-[600px]">
            <div className="text-center">
              <Eye className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">
                Click "Refresh" to generate a preview with sample data
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
