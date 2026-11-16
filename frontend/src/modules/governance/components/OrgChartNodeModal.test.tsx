/**
 * Forms review F-9: the position's contact phone was a plain text box, so a
 * phone showed the full keyboard, and the browser offered the officer's own
 * number for a line that belongs to the position.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import { OrgChartNodeModal } from './OrgChartNodeModal';

describe('OrgChartNodeModal contact phone', () => {
  it('is a phone field that does not offer the officer their own number', () => {
    renderWithRouter(
      <OrgChartNodeModal
        isOpen
        nodes={[]}
        members={[]}
        roles={[]}
        ranks={[]}
        isSaving={false}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const phone = screen.getByLabelText(/Contact phone/);
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('autocomplete', 'off');
  });
});
