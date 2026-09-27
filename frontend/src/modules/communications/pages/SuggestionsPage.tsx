/**
 * Suggestion boxes — the member page.
 *
 * Every member can submit, see their own named submissions and follow up on
 * an anonymous one by key. The Review tab appears only for members who
 * review at least one box; that is decided per box on the backend, not by a
 * permission, so the page asks rather than inferring it.
 *
 * `?tab=` and `?id=` are what the notification emails link to.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Lightbulb } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux';
import FollowUpKeyPanel from '../components/FollowUpKeyPanel';
import MySuggestionsPanel from '../components/MySuggestionsPanel';
import SuggestionBoardPanel from '../components/SuggestionBoardPanel';
import SuggestionReviewPanel from '../components/SuggestionReviewPanel';
import SuggestionSubmitForm from '../components/SuggestionSubmitForm';
import { suggestionsService } from '../services/suggestionsService';
import type { ReviewSummary, SuggestionBoxPublic } from '../types/suggestions';

type Tab = 'submit' | 'board' | 'mine' | 'key' | 'review';

const TAB_LABELS: Record<Tab, string> = {
  submit: 'Submit',
  board: 'Idea board',
  mine: 'My submissions',
  key: 'Follow up with a key',
  review: 'Review',
};

// Shorter labels for phones, where four full labels overflow the tab strip.
const SHORT_TAB_LABELS: Partial<Record<Tab, string>> = {
  board: 'Ideas',
  mine: 'Mine',
  key: 'Follow up',
};

const SuggestionsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [boardBoxes, setBoardBoxes] = useState<SuggestionBoxPublic[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    suggestionsService
      .getReviewSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        // Not being able to tell reviewer status only hides the Review tab;
        // submitting is unaffected, so this stays quiet unless the member was
        // sent straight to the Review tab (below).
        if (!cancelled) setSummaryFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    suggestionsService
      .listBoxes()
      .then((boxes) => {
        if (!cancelled) setBoardBoxes(boxes.filter((b) => b.publicBoardEnabled));
      })
      .catch(() => {
        // Only the Idea board tab depends on this; the Submit tab reports its
        // own failure to load boxes.
        if (!cancelled) setBoardBoxes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keeps the open-count badge honest after a reviewer closes something. A
  // failure here keeps the last count rather than hiding the tab mid-review.
  const refreshSummary = useCallback(() => {
    suggestionsService
      .getReviewSummary()
      .then(setSummary)
      .catch(() => undefined);
  }, []);

  const hasBoard = (boardBoxes?.length ?? 0) > 0;
  const tabs: Tab[] = [
    'submit',
    ...(hasBoard ? (['board'] as const) : []),
    'mine',
    'key',
    ...(summary?.isReviewer ? (['review'] as const) : []),
  ];
  const requested = searchParams.get('tab') as Tab | null;
  // A link opened before the data deciding its tab arrives should not bounce
  // to Submit.
  const stillLoading = (requested === 'review' && summary === null) || (requested === 'board' && boardBoxes === null);
  const active: Tab = requested && (tabs.includes(requested) || stillLoading) ? requested : 'submit';
  const selectedId = searchParams.get('id') ?? '';

  const activeTabRef = useRef<HTMLButtonElement>(null);
  // The strip scrolls sideways on a phone, so the active tab can sit off the
  // edge. Bring it into view whenever it changes — including when the Review
  // tab appears only after the reviewer summary loads.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  const selectTab = (tab: Tab) => setSearchParams(tab === 'submit' ? {} : { tab });
  const selectItem = (tab: Tab) => (id: string) => setSearchParams({ tab, id });

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Suggestions' }]} />
      <h1 className="text-theme-text-primary mb-4 flex items-center gap-2 text-2xl font-bold">
        <Lightbulb className="h-6 w-6" aria-hidden="true" />
        Suggestions
      </h1>

      <div className="tab-scroll mb-4" role="tablist" aria-label="Suggestions">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            ref={active === tab ? activeTabRef : undefined}
            aria-selected={active === tab}
            className={`mobile-touch-target px-4 py-2 text-sm font-medium whitespace-nowrap ${
              active === tab ? 'border-theme-accent-red text-theme-accent-red border-b-2' : 'text-theme-text-secondary'
            }`}
            onClick={() => selectTab(tab)}
          >
            {SHORT_TAB_LABELS[tab] ? (
              <>
                <span className="sm:hidden">{SHORT_TAB_LABELS[tab]}</span>
                <span className="hidden sm:inline">{TAB_LABELS[tab]}</span>
              </>
            ) : (
              TAB_LABELS[tab]
            )}
            {tab === 'review' && summary && summary.openCount > 0 && (
              <span className="badge ml-2 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                {summary.openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={TAB_LABELS[active]}>
        {active === 'submit' && <SuggestionSubmitForm onSubmitted={() => setRefreshToken((t) => t + 1)} />}
        {active === 'board' && hasBoard && <SuggestionBoardPanel boxes={boardBoxes ?? []} />}
        {active === 'mine' && (
          <MySuggestionsPanel selectedId={selectedId} onSelect={selectItem('mine')} refreshToken={refreshToken} />
        )}
        {active === 'key' && <FollowUpKeyPanel />}
        {active === 'review' && summary?.isReviewer && (
          <SuggestionReviewPanel
            boxes={summary.boxes}
            selectedId={selectedId}
            onSelect={selectItem('review')}
            onReviewed={refreshSummary}
          />
        )}
        {active === 'review' && summaryFailed && (
          <p role="alert" className="alert-danger text-sm">
            Unable to load the boxes you review. Please reload the page to try again.
          </p>
        )}
      </div>
    </div>
  );
};

export default SuggestionsPage;
