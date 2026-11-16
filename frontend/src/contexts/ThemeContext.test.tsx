import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext';

// The same per-theme `--nav-bg` the real stylesheet declares on these
// selectors; jsdom loads no CSS, so the test supplies the cascade it reads.
const NAV_BG_CSS = `
  :root { --nav-bg: #ffffff; }
  .dark { --nav-bg: #0f172a; }
  .high-contrast { --nav-bg: #000000; }
`;

let setTheme: ReturnType<typeof useTheme>['setTheme'] = () => undefined;

const Capture: React.FC = () => {
  setTheme = useTheme().setTheme;
  return null;
};

let metas: HTMLMetaElement[] = [];
const themeColors = () => metas.map((meta) => meta.content);

describe('ThemeProvider browser theme-color', () => {
  let style: HTMLStyleElement;

  beforeEach(() => {
    localStorage.clear();
    style = document.createElement('style');
    style.textContent = NAV_BG_CSS;
    document.head.appendChild(style);
    // Mirrors index.html: one tag per system colour scheme.
    metas = [];
    for (const [content, media] of [
      ['#991b1b', '(prefers-color-scheme: light)'],
      ['#0f172a', '(prefers-color-scheme: dark)'],
    ] as const) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = content;
      meta.media = media;
      document.head.appendChild(meta);
      metas.push(meta);
    }
  });

  afterEach(() => {
    style.remove();
    metas.forEach((meta) => meta.remove());
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
  });

  it('paints every theme-color tag with the navigation colour of the theme chosen in the app', () => {
    localStorage.setItem('theme-preference', 'light');
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>
    );
    expect(themeColors()).toEqual(['#ffffff', '#ffffff']);

    act(() => setTheme('dark'));
    expect(themeColors()).toEqual(['#0f172a', '#0f172a']);

    act(() => setTheme('high-contrast'));
    expect(themeColors()).toEqual(['#000000', '#000000']);
  });

  it('leaves the tags alone when no stylesheet supplies a navigation colour', () => {
    style.remove();
    localStorage.setItem('theme-preference', 'dark');
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>
    );
    expect(themeColors()).toEqual(['#991b1b', '#0f172a']);
  });
});
