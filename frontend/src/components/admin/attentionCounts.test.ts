import { describe, it, expect } from 'vitest';
import type { AdminAttentionItem } from '../../types/adminHub';
import { attentionCountsForTabs } from './attentionCounts';

const item = (href: string, count: number): AdminAttentionItem => ({
  key: href,
  title: 't',
  detail: '',
  actionLabel: 'Open',
  href,
  severity: 'warning',
  count,
  oldestAgeDays: null,
});

describe('attentionCountsForTabs', () => {
  it('sums items by the tab of this hub each one links to', () => {
    expect(
      attentionCountsForTabs(
        [
          item('/inventory/admin/store?tab=orders&payment=pending_verification', 3),
          item('/inventory/admin/store?tab=payments', 2),
          item('/inventory/admin/store?tab=orders', 1),
        ],
        '/inventory/admin/store'
      )
    ).toEqual({ orders: 4, payments: 2 });
  });

  it('ignores items for another page or for no tab', () => {
    expect(
      attentionCountsForTabs(
        [item('/events', 5), item('/events/admin', 1), item('/inventory/admin?tab=requests', 2)],
        '/events/admin'
      )
    ).toEqual({});
  });
});
