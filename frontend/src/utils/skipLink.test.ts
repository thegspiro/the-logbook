import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installSkipLinkFocus } from './skipLink';

describe('installSkipLinkFocus', () => {
  let uninstall: () => void;

  beforeEach(() => {
    document.body.innerHTML = `
      <a href="#main-content" class="skip-to-main">Skip to main content</a>
      <nav><a href="/elsewhere">Elsewhere</a></nav>
      <main id="main-content" tabindex="-1">Content</main>`;
    Element.prototype.scrollIntoView = () => undefined;
    uninstall = installSkipLinkFocus();
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  it('moves focus to the target rather than only scrolling to it', () => {
    document.querySelector<HTMLAnchorElement>('.skip-to-main')?.click();
    expect(document.activeElement).toBe(document.getElementById('main-content'));
  });

  it('ignores ordinary links', () => {
    const link = document.querySelector<HTMLAnchorElement>('nav a');
    link?.addEventListener('click', (event) => event.preventDefault());
    link?.click();
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves the link alone when the page has no target', () => {
    document.getElementById('main-content')?.remove();
    expect(() => document.querySelector<HTMLAnchorElement>('.skip-to-main')?.click()).not.toThrow();
  });
});
