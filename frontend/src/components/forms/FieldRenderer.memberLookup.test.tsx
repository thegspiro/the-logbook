/**
 * A member lookup answers with the chosen member's id. Editing the name after
 * choosing must un-choose them, and a slow search for an earlier prefix must
 * not replace the results for what has been typed since.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MemberLookupResult } from '../../services/api';

const { mockMemberLookup, mockGetRankLadder } = vi.hoisted(() => ({
  mockMemberLookup: vi.fn(),
  mockGetRankLadder: vi.fn(),
}));
vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    formsService: { memberLookup: mockMemberLookup },
    ranksService: { getRankLadder: mockGetRankLadder },
  };
});

import { FieldType } from '../../constants/enums';
import { invalidateRanksCache } from '../../hooks/ranksCache';
import FieldRenderer from './FieldRenderer';
import type { FieldDefinition } from './FieldRenderer';

const field: FieldDefinition = {
  id: 'member',
  label: 'Member',
  field_type: FieldType.MEMBER_LOOKUP,
  required: false,
  sort_order: 0,
  width: 'full',
};

const member = (id: string, first: string, last: string): MemberLookupResult => ({
  id,
  first_name: first,
  last_name: last,
  full_name: `${first} ${last}`,
});

const answers: string[] = [];
const Harness = () => {
  const [value, setValue] = useState('');
  return (
    <FieldRenderer
      field={field}
      value={value}
      onChange={(_id, v) => {
        answers.push(v);
        setValue(v);
      }}
    />
  );
};

describe('FieldRenderer member lookup', () => {
  beforeEach(() => {
    answers.length = 0;
    invalidateRanksCache();
    mockGetRankLadder.mockReset();
    mockGetRankLadder.mockResolvedValue([]);
    mockMemberLookup.mockReset();
  });

  it('clears the chosen member when the name is edited', async () => {
    mockMemberLookup.mockResolvedValue({ members: [member('m-john', 'John', 'Smith')] });
    const user = userEvent.setup();
    render(<Harness />);

    const box = screen.getByRole('textbox');
    await user.type(box, 'jo');
    await user.click(await screen.findByRole('button', { name: 'John Smith' }));
    expect(answers[answers.length - 1]).toBe('m-john');

    await user.clear(box);
    await user.type(box, 'Jane');

    expect(answers[answers.length - 1]).toBe('');
  });

  it('keeps the results for the latest search when an earlier one answers late', async () => {
    let releaseJo: (value: unknown) => void = () => undefined;
    mockMemberLookup.mockImplementation((query: string) =>
      query === 'jo'
        ? new Promise((resolve) => {
            releaseJo = resolve;
          })
        : Promise.resolve({ members: [member('m-john', 'John', 'Smith')] })
    );
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole('textbox'), 'john');
    await screen.findByRole('button', { name: 'John Smith' });
    releaseJo({ members: [member('m-joanne', 'Joanne', 'Reyes')] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole('button', { name: 'John Smith' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Joanne Reyes' })).not.toBeInTheDocument();
  });
});
