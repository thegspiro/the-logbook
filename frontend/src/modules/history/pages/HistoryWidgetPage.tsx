/**
 * The "Today in history" widget (`/embed/history/:token`), framed by the
 * department's own website. No navigation and no sign-in: the secret link is
 * the widget's only credential, and which sites may frame it is decided by
 * nginx from the Public Portal's allowed websites.
 *
 * On a day with nothing, the server sends "This week in history" instead;
 * with nothing in the coming week either, the widget renders nothing at all,
 * so the host page shows no empty box.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { historyWidgetService } from '../services/publicWidget';
import type { HistoryWidgetToday, PublicWidgetTheme } from '../types';

const THEMES: Record<PublicWidgetTheme, string> = {
  // `auto` follows the visitor's own setting through the media query, since
  // the host page's theme cannot be read from inside the frame.
  auto: 'bg-white text-slate-900 dark:bg-slate-900 dark:text-white',
  light: 'bg-white text-slate-900',
  dark: 'bg-slate-900 text-white',
};

const useSystemDark = (): boolean => {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const change = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return dark;
};

const yearsAgo = (years: number): string => (years === 1 ? '1 year ago' : `${years} years ago`);

export const HistoryWidgetPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [answer, setAnswer] = useState<HistoryWidgetToday | null | undefined>(undefined);
  const systemDark = useSystemDark();

  useEffect(() => {
    let cancelled = false;
    historyWidgetService
      .today(token)
      .then((data) => {
        if (!cancelled) setAnswer(data);
      })
      .catch(() => {
        // A replaced link, a switched-off widget or an outage all look the
        // same from a visitor's side: nothing to show.
        if (!cancelled) setAnswer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!answer || answer.mode === 'none') return null;

  const dark = answer.theme === 'dark' || (answer.theme === 'auto' && systemDark);
  const heading = answer.mode === 'today' ? 'Today in history' : 'This week in history';

  return (
    <main
      className={`${THEMES[answer.theme]} ${dark ? 'dark' : ''} min-h-screen p-4 font-sans`}
      data-theme={dark ? 'dark' : 'light'}
    >
      <header className="mb-3 flex items-center gap-3">
        {answer.has_logo && <img src="/api/public/v1/branding/icon/192.png" alt="" className="h-10 w-10 rounded-sm" />}
        <div>
          <h1 className="text-lg font-semibold">{heading}</h1>
          {answer.organization_name && <p className="text-sm opacity-90">{answer.organization_name}</p>}
        </div>
      </header>
      <ul className="space-y-2">
        {answer.entries.map((entry) => (
          <li key={`${entry.key}:${entry.anniversary}`} className="text-sm">
            <span className="font-semibold">
              {answer.mode === 'week'
                ? `${formatCalendarDate(entry.anniversary, { month: 'long', day: 'numeric' })}, ${entry.date.slice(0, 4)}`
                : entry.date.slice(0, 4)}
            </span>{' '}
            <span>{entry.label}</span>
            {entry.detail && <span> ({entry.detail})</span>}
            <span className="opacity-90"> · {yearsAgo(entry.years_ago)}</span>
          </li>
        ))}
      </ul>
    </main>
  );
};

export default HistoryWidgetPage;
