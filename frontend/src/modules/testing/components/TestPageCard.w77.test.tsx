/**
 * Workflow review W77: what a test card tells the tester.
 *
 * - A card for a page this account should be refused said so, but not how to
 *   record it. The verdict reads Blocked as "refused" and Pass as "opened", so
 *   a tester who met the expected refusal and marked it Pass was told it was a
 *   permissions defect.
 * - Another tester's note was only a `title` tooltip, out of reach on a phone.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestPageCard } from './TestPageCard';
import type { TestPageEntry } from '../testingRegistry';

const AUDIT_LOG: TestPageEntry = { path: '/admin/audit-log', label: 'Audit log', permission: 'audit.view' };
const ORG_CHART: TestPageEntry = { path: '/governance/org-chart', label: 'Org Chart' };

const handlers = { onStatus: vi.fn(), onNote: vi.fn(), onParam: vi.fn() };

describe('TestPageCard (W77)', () => {
  it('says how to mark a page that should refuse', () => {
    render(
      <TestPageCard
        page={AUDIT_LOG}
        result={undefined}
        access={{ kind: 'denied', missing: ['audit.view'] }}
        {...handlers}
      />
    );

    expect(screen.getByText(/should refuse with Access Denied/)).toHaveTextContent(
      'Mark Blocked if it refuses; Pass means it opened.'
    );
  });

  it("shows another tester's note on the card", () => {
    render(
      <TestPageCard
        page={ORG_CHART}
        result={undefined}
        access={{ kind: 'open' }}
        otherMarks={[
          {
            markId: 'm1',
            userId: 'u2',
            testerName: 'Jordan Avery',
            testedAs: ['firefighter'],
            status: 'pass',
            note: 'Chief card text clips at 390px',
          },
        ]}
        {...handlers}
      />
    );

    expect(screen.getByText('Chief card text clips at 390px')).toBeVisible();
  });
});
