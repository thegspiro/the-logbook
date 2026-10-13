/**
 * The one "Skip to main content" link is static, in index.html, so it is the
 * first tab stop on every page — inside the app shell and on the public and
 * onboarding pages that render without it. A second copy in AppLayout made the
 * first two tab stops both skip links, the first of which did nothing.
 *
 * Following the hash alone only scrolls in some browsers; it does not move the
 * focus point, so the next Tab lands back in the navigation. This moves real
 * focus to the target, which carries tabIndex={-1} so it can take focus without
 * joining the tab order.
 */
export const SKIP_LINK_SELECTOR = 'a.skip-to-main[href^="#"]';

export function installSkipLinkFocus(root: Document = document): () => void {
  const handleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>(SKIP_LINK_SELECTOR);
    if (!link) return;
    const target = root.getElementById(link.hash.slice(1));
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: 'start' });
  };
  root.addEventListener('click', handleClick);
  return () => root.removeEventListener('click', handleClick);
}
