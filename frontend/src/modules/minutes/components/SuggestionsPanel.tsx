/**
 * Suggested changes while minutes are circulated for review.
 *
 * Circulated minutes are locked, so a suggestion never edits them. A member
 * suggests a change from the section it is about (see SuggestChangeForm) or, here,
 * to the minutes as a whole; the secretary accepts or declines each one, recalls
 * the minutes to draft to make the accepted changes, and circulates them again.
 * A member sees only their own suggestions; a secretary sees all of them and is
 * not offered a form: the secretary corrects the minutes, not suggests to them.
 * An accepted suggestion is what makes the adoption "as amended".
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { MessageSquarePlus } from 'lucide-react';
import { PromptDialog } from '../../../components/ux/PromptDialog';
import { SuggestChangeForm } from './SuggestChangeForm';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { MinutesStatus, MinutesSuggestion, SectionEntry } from '../types/minutes';

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  accepted: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  declined: 'bg-theme-surface-secondary text-theme-text-secondary',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  accepted: 'Accepted',
  declined: 'Declined',
};

interface SuggestionsPanelProps {
  minutesId: string;
  status: MinutesStatus;
  sections: SectionEntry[];
  canManage: boolean;
  suggestions: MinutesSuggestion[];
  loaded: boolean;
  reload: () => Promise<void>;
}

export const SuggestionsPanel: React.FC<SuggestionsPanelProps> = ({
  minutesId,
  status,
  sections,
  canManage,
  suggestions,
  loaded,
  reload,
}) => {
  const tz = useTimezone();
  const [suggestingOverall, setSuggestingOverall] = useState(false);
  const [declining, setDeclining] = useState<MinutesSuggestion | null>(null);

  const circulating = status === 'submitted';
  const canAnswer = canManage && status !== 'approved';
  const canSuggest = circulating && !canManage;

  const sectionTitle = (key?: string | null) =>
    key ? (sections.find((s) => s.key === key)?.title ?? key) : 'The minutes as a whole';

  const answer = async (suggestion: MinutesSuggestion, result: 'accepted' | 'declined', note?: string) => {
    try {
      await minutesService.resolveSuggestion(minutesId, suggestion.id, result, note);
      await reload();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to answer the suggestion'));
    }
  };

  if (!loaded || (!circulating && suggestions.length === 0)) return null;

  return (
    <section
      className="bg-theme-surface mb-6 rounded-lg p-4 shadow-sm backdrop-blur-xs"
      aria-labelledby="suggestions-heading"
    >
      <h2 id="suggestions-heading" className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
        <MessageSquarePlus className="h-5 w-5" aria-hidden="true" />
        {canManage ? `Suggested changes (${suggestions.length})` : 'Your suggestions'}
      </h2>

      {canSuggest && (
        <div className="mt-3">
          <p className="text-theme-text-secondary text-sm">
            These minutes are circulated for review. Use <strong>Suggest a change</strong> on the section you want
            changed, or suggest a change to the minutes as a whole.
          </p>
          {suggestingOverall ? (
            <SuggestChangeForm
              minutesId={minutesId}
              subject="the minutes as a whole"
              onSent={async () => {
                setSuggestingOverall(false);
                await reload();
              }}
              onCancel={() => setSuggestingOverall(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setSuggestingOverall(true)}
              className="btn-secondary touch:min-h-11 mt-2 text-sm"
            >
              Suggest a change to the minutes as a whole
            </button>
          )}
        </div>
      )}

      {suggestions.length === 0 ? (
        <p className="text-theme-text-muted mt-3 text-xs italic">
          {canManage ? 'No suggestions yet.' : 'You have not suggested anything.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {suggestions.map((s) => (
            <li key={s.id} className="border-theme-surface-border rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-theme-text-primary text-sm font-medium">{sectionTitle(s.section_key)}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[s.status] ?? ''}`}>
                  {STATUS_LABEL[s.status] ?? s.status}
                </span>
              </div>
              <p className="text-theme-text-muted text-xs">
                {s.created_by_name ?? 'A member'} &middot; {formatDateTime(s.created_at, tz)}
              </p>
              <p className="text-theme-text-primary mt-2 text-sm whitespace-pre-wrap">{s.comment}</p>
              {s.proposed_text && (
                <blockquote className="border-theme-surface-border text-theme-text-secondary mt-2 border-l-4 pl-3 text-sm whitespace-pre-wrap">
                  {s.proposed_text}
                </blockquote>
              )}
              {s.status !== 'open' && (
                <p className="text-theme-text-muted mt-2 text-xs">
                  {STATUS_LABEL[s.status]}
                  {s.resolved_by_name ? ` by ${s.resolved_by_name}` : ''}
                  {s.resolved_at ? ` · ${formatDateTime(s.resolved_at, tz)}` : ''}
                  {s.resolution_note ? `: ${s.resolution_note}` : ''}
                </p>
              )}
              {canAnswer && s.status === 'open' && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void answer(s, 'accepted');
                    }}
                    className="btn-success touch:min-h-11 text-sm"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclining(s)}
                    className="btn-secondary touch:min-h-11 text-sm"
                  >
                    Decline
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <PromptDialog
        isOpen={declining !== null}
        onClose={() => setDeclining(null)}
        onSubmit={(note) => {
          const target = declining;
          setDeclining(null);
          if (target) void answer(target, 'declined', note);
        }}
        title="Decline this suggestion"
        message="The member sees your reason next to their suggestion."
        label="Reason (optional)"
        required={false}
        multiline
        confirmLabel="Decline"
      />
    </section>
  );
};

export default SuggestionsPanel;
