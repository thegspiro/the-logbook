import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'light' | 'dark' | 'system' | 'high-contrast';
type ResolvedTheme = 'light' | 'dark' | 'high-contrast';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'theme-preference';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemPreference(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

function getSavedTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'system' || saved === 'high-contrast') {
    return saved;
  }
  return 'system';
}

function applyThemeToDocument(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  if (resolved === 'high-contrast') {
    root.classList.add('dark');
    root.classList.add('high-contrast');
  } else {
    root.classList.remove('high-contrast');
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
  root.setAttribute('data-theme', resolved);
  syncBrowserThemeColor(root);
}

/**
 * Paint the browser and OS chrome (Android's status bar, Chrome's toolbar) in
 * the navigation bar's colour, so the header and bottom bar do not look as if
 * they float on a band of a different colour.
 *
 * index.html's two `theme-color` tags choose by `prefers-color-scheme`, which
 * is the phone's setting, not the theme picked in the app: a member who chose
 * Light on a dark phone got a navy status bar above a white header. Every tag
 * is rewritten rather than one, because whichever media query matches is the
 * one the browser reads. The colour is read from `--nav-bg` so the stylesheet
 * stays the only place the per-theme navigation colour is defined; an empty
 * value (no stylesheet loaded) leaves the tags as they were.
 *
 * The manifest's `theme_color` is separate and fixed at install time — see
 * vite.config.ts.
 */
function syncBrowserThemeColor(root: HTMLElement): void {
  const navBg = getComputedStyle(root).getPropertyValue('--nav-bg').trim();
  if (!navBg) return;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = navBg;
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getSavedTheme);
  const [systemPreference, setSystemPreference] = useState<ResolvedTheme>(getSystemPreference);

  const resolvedTheme: ResolvedTheme =
    theme === 'system' ? systemPreference : theme === 'high-contrast' ? 'high-contrast' : theme;

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  }, []);

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia(MEDIA_QUERY);

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemPreference(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  // Apply theme to document whenever resolvedTheme changes
  useEffect(() => {
    applyThemeToDocument(resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
