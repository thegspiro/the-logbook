/**
 * The write affordances here are gated on the department's call-tracking mode,
 * not only on the viewer's permission. The backend has always refused
 * `create_shift_call` / `update_shift_call` outside `detailed` mode; before the
 * gate this component still rendered its Log Call button to a count-only
 * department, so the only way to discover the refusal was a red toast after
 * typing out an incident.
 *
 * Reading and deleting stay available on purpose, and that is asserted here
 * rather than left to review: rows written before a mode switch are the
 * department's history, so they must remain visible and must remain clearable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetShiftCalls = vi.fn();
const mockCreateCall = vi.fn();
const mockUpdateCall = vi.fn();
const mockDeleteCall = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getShiftCalls: (...a: unknown[]) => mockGetShiftCalls(...a) as unknown,
    createCall: (...a: unknown[]) => mockCreateCall(...a) as unknown,
    updateCall: (...a: unknown[]) => mockUpdateCall(...a) as unknown,
    deleteCall: (...a: unknown[]) => mockDeleteCall(...a) as unknown,
  },
}));

import { ShiftCallsSection } from './ShiftCallsSection';

const call = {
  id: 'call-1',
  shift_id: 'shift-1',
  incident_type: 'structure fire',
  incident_number: 'CAD-9',
  dispatched_at: null,
  on_scene_at: null,
  cleared_at: null,
  cancelled_en_route: false,
  medical_refusal: false,
  responding_members: [],
  notes: null,
};

const renderSection = (props: { canManage?: boolean; canLog?: boolean } = {}) =>
  render(
    <ShiftCallsSection shiftId="shift-1" canManage={props.canManage ?? true} canLog={props.canLog ?? true} tz="UTC" />
  );

describe('ShiftCallsSection', () => {
  // Per CLAUDE.md #28: state the implementation this block depends on rather
  // than inheriting whatever ran last, and reset before installing it.
  beforeEach(() => {
    mockGetShiftCalls.mockReset();
    mockGetShiftCalls.mockResolvedValue([]);
    mockCreateCall.mockReset();
    mockUpdateCall.mockReset();
    mockDeleteCall.mockReset();
  });

  describe('when the department logs individual calls', () => {
    it('offers Log Call', async () => {
      renderSection({ canLog: true });
      expect(await screen.findByRole('button', { name: /log call/i })).toBeInTheDocument();
    });

    it('offers Edit on a recorded call', async () => {
      mockGetShiftCalls.mockResolvedValue([call]);
      renderSection({ canLog: true });
      expect(await screen.findByRole('button', { name: /edit call/i })).toBeInTheDocument();
    });
  });

  describe('when the department does not log individual calls', () => {
    it('does not offer Log Call', async () => {
      mockGetShiftCalls.mockResolvedValue([call]);
      renderSection({ canLog: false });
      // Wait for the row, so "absent" is a decision this component made and
      // not merely the loading state that precedes every render.
      expect(await screen.findByText('structure fire')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /log call/i })).not.toBeInTheDocument();
    });

    it('does not offer Edit, but still offers Remove', async () => {
      mockGetShiftCalls.mockResolvedValue([call]);
      renderSection({ canLog: false });
      expect(await screen.findByRole('button', { name: /remove call/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /edit call/i })).not.toBeInTheDocument();
    });

    it('says why logging is unavailable rather than just dropping the button', async () => {
      mockGetShiftCalls.mockResolvedValue([call]);
      renderSection({ canLog: false });
      expect(await screen.findByText(/no longer logs individual calls/i)).toBeInTheDocument();
    });

    it('renders nothing at all when there is no history to show', async () => {
      mockGetShiftCalls.mockResolvedValue([]);
      const { container } = renderSection({ canLog: false });
      // A count-only department should not carry an empty "Calls" heading on
      // every shift panel its officers open.
      await waitFor(() => expect(container).toBeEmptyDOMElement());
    });
  });

  describe('when the viewer cannot manage the shift', () => {
    it('shows the calls read-only even with logging on', async () => {
      mockGetShiftCalls.mockResolvedValue([call]);
      renderSection({ canManage: false, canLog: true });
      expect(await screen.findByText('structure fire')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /log call/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /remove call/i })).not.toBeInTheDocument();
    });
  });
});
