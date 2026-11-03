/**
 * FieldRenderer asks for the department's ranks only for a member lookup.
 *
 * The ranks label a matched member in the lookup's results, and nothing else
 * reads them. Asking for them on every field broke the applicant's follow-up
 * form: the page is opened signed out, the request answers 401, and the shared
 * client sends the browser to /login.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const { mockGetRankLadder } = vi.hoisted(() => ({ mockGetRankLadder: vi.fn() }));
vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return { ...actual, ranksService: { getRankLadder: mockGetRankLadder } };
});

import { FieldType } from '../../constants/enums';
import { invalidateRanksCache } from '../../hooks/ranksCache';
import FieldRenderer from './FieldRenderer';
import type { FieldDefinition } from './FieldRenderer';

const field = (field_type: string): FieldDefinition => ({
  id: 'f1',
  label: 'Field',
  field_type,
  required: false,
  sort_order: 0,
  width: 'full',
});

describe('FieldRenderer and the rank list', () => {
  beforeEach(() => {
    mockGetRankLadder.mockReset();
    mockGetRankLadder.mockResolvedValue([]);
    invalidateRanksCache();
  });

  it.each([FieldType.TEXT, FieldType.TEXTAREA, FieldType.SELECT, FieldType.RADIO, FieldType.DATE])(
    'does not ask for ranks for a %s field',
    async (type) => {
      render(<FieldRenderer field={field(type)} value="" onChange={vi.fn()} />);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockGetRankLadder).not.toHaveBeenCalled();
    }
  );

  it("asks for ranks for a member lookup, whose results show each member's rank", async () => {
    render(<FieldRenderer field={field(FieldType.MEMBER_LOOKUP)} value="" onChange={vi.fn()} />);

    await waitFor(() => expect(mockGetRankLadder).toHaveBeenCalledTimes(1));
  });
});
