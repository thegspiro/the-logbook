import type { AdminAttentionItem } from '../../types/adminHub';

/**
 * Open attention items per tab of the hub at `pathname`.
 *
 * The queue already links every item to the tab that resolves it; counting by
 * that link means a card can never disagree with the queue above it. Items
 * pointing at another page, or at no tab, are not counted.
 */
export const attentionCountsForTabs = (items: AdminAttentionItem[], pathname: string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    // Any origin will do: hrefs are app-relative, and only the path and query matter.
    const url = new URL(item.href, 'http://hub.invalid');
    const tab = url.searchParams.get('tab');
    if (url.pathname !== pathname || !tab) continue;
    counts[tab] = (counts[tab] ?? 0) + item.count;
  }
  return counts;
};
