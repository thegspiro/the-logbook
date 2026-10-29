import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberClassificationFields } from './MemberClassificationFields';

const tiers = [
  { id: 'active', name: 'Active Member', years_required: 1, sort_order: 1, benefits: {} },
  { id: 'senior', name: 'Senior Member', years_required: 10, sort_order: 2, benefits: {} },
];

describe('MemberClassificationFields', () => {
  it('offers class and status as two controls and reports each change', async () => {
    const user = userEvent.setup();
    const onClassChange = vi.fn();
    const onStatusChange = vi.fn();
    render(
      <MemberClassificationFields
        memberClass="operational"
        memberStatus="regular"
        onClassChange={onClassChange}
        onStatusChange={onStatusChange}
        tiers={tiers}
      />
    );

    await user.selectOptions(screen.getByRole('combobox', { name: /member class/i }), 'administrative');
    expect(onClassChange).toHaveBeenCalledWith('administrative');

    await user.selectOptions(screen.getByRole('combobox', { name: /membership status/i }), 'senior');
    expect(onStatusChange).toHaveBeenCalledWith('senior');
  });

  it("names the ladder's rungs by the department's own names", () => {
    render(
      <MemberClassificationFields
        memberClass="operational"
        memberStatus="regular"
        onClassChange={vi.fn()}
        onStatusChange={vi.fn()}
        tiers={tiers}
      />
    );
    expect(screen.getByRole('option', { name: 'Active Member' })).toHaveValue('regular');
    expect(screen.getByRole('option', { name: 'Senior Member' })).toHaveValue('senior');
    expect(screen.getByRole('option', { name: 'Life' })).toHaveValue('life');
  });

  it('still shows a stored status that neither list names', () => {
    render(
      <MemberClassificationFields
        memberClass="operational"
        memberStatus="cadet"
        onClassChange={vi.fn()}
        onStatusChange={vi.fn()}
        currentStatus="cadet"
      />
    );
    expect(screen.getByRole('combobox', { name: /membership status/i })).toHaveValue('cadet');
  });

  it('marks both as required when asked, and disables both when asked', () => {
    render(
      <MemberClassificationFields
        memberClass="social"
        memberStatus="honorary"
        onClassChange={vi.fn()}
        onStatusChange={vi.fn()}
        required
        disabled
      />
    );
    expect(screen.getByRole('combobox', { name: /member class/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /membership status/i })).toBeDisabled();
    expect(screen.getAllByText('*')).toHaveLength(2);
  });
});
