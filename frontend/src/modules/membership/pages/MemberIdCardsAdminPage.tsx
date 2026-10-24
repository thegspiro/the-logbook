/**
 * Member ID Cards — the department-wide view of NFC ID cards.
 *
 * Issuing one card still happens on a member's profile; this page is for the
 * work across the whole roster: finding a card, changing many at once, seeing
 * who has no card and which cards a leaver still holds, and answering "why
 * didn't my card work" from the tap log.
 *
 * URL: /members/admin/id-cards. Requires `members.manage_id_cards` alone — not
 * `members.manage` — so a card clerk who does not edit the roster can reach it
 * directly; the Members hub links here for those who do. The organization must
 * have the NFC ID Cards integration on; every endpoint refuses while it is
 * off, so the page says so rather than showing a wall of errors.
 */

import React, { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CreditCard, Nfc } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux';
import { EmptyState } from '../../../components/ux/EmptyState';
import { useConnectedIntegrations } from '../../../hooks/useConnectedIntegrations';
import { useTablist } from '../../../hooks/useTablist';
import { NFC_ID_CARDS_INTEGRATION } from '../constants/idCards';
import { CardRosterTab } from '../components/idCardsAdmin/CardRosterTab';
import { CoverageTab } from '../components/idCardsAdmin/CoverageTab';
import { TapLogTab, type TapLogScope } from '../components/idCardsAdmin/TapLogTab';
import { IdCardSettingsTab } from '../components/idCardsAdmin/IdCardSettingsTab';
import type { NfcCard } from '../types/idCard';

const TABS = ['cards', 'coverage', 'taps', 'settings'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  cards: 'Cards',
  coverage: 'Coverage',
  taps: 'Tap log',
  settings: 'Settings',
};

const isTab = (value: string | null): value is Tab => TABS.includes(value as Tab);

const MemberIdCardsAdminPage: React.FC = () => {
  const { isConnected, loading: integrationsLoading } = useConnectedIntegrations();
  const cardsEnabled = isConnected(NFC_ID_CARDS_INTEGRATION);
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const active: Tab = isTab(requested) ? requested : 'cards';
  const tablist = useTablist();
  const activeTabRef = useRef<HTMLButtonElement>(null);

  const [tapScope, setTapScope] = useState<TapLogScope | null>(null);
  // Bumped when one tab changes cards, so the others reload rather than show
  // a status the change just made stale.
  const [refreshToken, setRefreshToken] = useState(0);
  const bump = useCallback(() => setRefreshToken((t) => t + 1), []);

  const selectTab = useCallback((tab: Tab) => setSearchParams(tab === 'cards' ? {} : { tab }), [setSearchParams]);

  const showTapsFor = useCallback(
    (card: NfcCard) => {
      setTapScope({
        tagId: card.id,
        label: `${card.memberName || 'Unknown member'} · …${card.uidPreview}`,
      });
      selectTab('taps');
    },
    [selectTab]
  );

  const header = (
    <>
      <Breadcrumbs underHub="/members/admin" />
      <div className="flex items-center gap-3">
        <CreditCard className="text-theme-text-secondary h-6 w-6" aria-hidden="true" />
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Member ID Cards</h1>
          <p className="text-theme-text-secondary text-sm">
            Every NFC ID card in the department, who is missing one, and every tap.
          </p>
        </div>
      </div>
    </>
  );

  if (!integrationsLoading && !cardsEnabled) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        {header}
        <div className="card p-4 sm:p-6">
          <EmptyState
            icon={Nfc}
            title="NFC ID cards are turned off"
            description="An administrator can turn them on under Settings → Integrations. Until then no card can be issued or read."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {header}

      <div className="tab-scroll" role="tablist" {...tablist} aria-label="ID card areas">
        {TABS.map((tab) => (
          <button
            key={tab}
            id={`id-cards-tab-${tab}`}
            type="button"
            role="tab"
            ref={active === tab ? activeTabRef : undefined}
            aria-selected={active === tab}
            aria-controls="id-cards-panel"
            className={`mobile-touch-target px-4 py-2 text-sm font-medium whitespace-nowrap ${
              active === tab ? 'border-theme-accent-red text-theme-accent-red border-b-2' : 'text-theme-text-secondary'
            }`}
            onClick={() => selectTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {!integrationsLoading && (
        <div id="id-cards-panel" role="tabpanel" aria-labelledby={`id-cards-tab-${active}`}>
          {active === 'cards' && (
            <CardRosterTab onShowTaps={showTapsFor} refreshToken={refreshToken} onChanged={bump} />
          )}
          {active === 'coverage' && <CoverageTab refreshToken={refreshToken} onChanged={bump} />}
          {active === 'taps' && <TapLogTab scope={tapScope} onClearScope={() => setTapScope(null)} />}
          {active === 'settings' && <IdCardSettingsTab />}
        </div>
      )}
    </div>
  );
};

export default MemberIdCardsAdminPage;
