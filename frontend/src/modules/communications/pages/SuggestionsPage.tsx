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

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Lightbulb } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux';
import FollowUpKeyPanel from '../components/FollowUpKeyPanel';
import MySuggestionsPanel from '../components/MySuggestionsPanel';
import SuggestionReviewPanel from '../components/SuggestionReviewPanel';
import SuggestionSubmitForm from '../components/SuggestionSubmitForm';
import { suggestionsService } from '../services/suggestionsService';
import type { ReviewSummary } from '../types/suggestions';

type Tab = 'submit' | 'mine' | 'key' | 'review';

const TAB_LABELS: Record<Tab, string> = {
  submit: 'Submit',
  mine: 'My submissions',
  key: 'Follow up with a key',
  review: 'Review',
};

const SuggestionsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    suggestionsService
      .getReviewSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        // Not being able to tell reviewer status only hides the Review tab;
        // submitting is unaffected, so this stays quiet.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs: Tab[] = summary?.isReviewer ? ['submit', 'mine', 'key', 'review'] : ['submit', 'mine', 'key'];
  const requested = searchParams.get('tab') as Tab | null;
  // A review link opened before the summary arrives should not bounce to Submit.
  const active: Tab =
    requested && (tabs.includes(requested) || (requested === 'review' && summary === null)) ? requested : 'submit';
  const selectedId = searchParams.get('id') ?? '';

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
            aria-selected={active === tab}
            className={`mobile-touch-target px-4 py-2 text-sm font-medium whitespace-nowrap ${
              active === tab ? 'border-theme-accent-red text-theme-accent-red border-b-2' : 'text-theme-text-secondary'
            }`}
            onClick={() => selectTab(tab)}
          >
            {TAB_LABELS[tab]}
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
        {active === 'mine' && (
          <MySuggestionsPanel selectedId={selectedId} onSelect={selectItem('mine')} refreshToken={refreshToken} />
        )}
        {active === 'key' && <FollowUpKeyPanel />}
        {active === 'review' && summary?.isReviewer && (
          <SuggestionReviewPanel boxes={summary.boxes} selectedId={selectedId} onSelect={selectItem('review')} />
        )}
      </div>
    </div>
  );
};

export default SuggestionsPage;
