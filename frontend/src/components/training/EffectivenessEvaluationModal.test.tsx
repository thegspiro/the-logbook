import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreateEvaluation = vi.fn();
const mockGetCourses = vi.fn();

vi.mock('../../services/trainingServices', () => ({
  effectivenessService: {
    createEvaluation: (...args: unknown[]) => mockCreateEvaluation(...args) as unknown,
  },
}));

vi.mock('../../services/api', () => ({
  trainingService: {
    getCourses: (...args: unknown[]) => mockGetCourses(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { EffectivenessEvaluationModal } from './EffectivenessEvaluationModal';

const member = { userId: 'u-1', memberName: 'Jordan Avery' };

const renderModal = (onSaved = vi.fn()) =>
  render(<EffectivenessEvaluationModal isOpen onClose={vi.fn()} onSaved={onSaved} member={member} />);

describe('EffectivenessEvaluationModal', () => {
  beforeEach(() => {
    mockCreateEvaluation.mockReset();
    mockCreateEvaluation.mockResolvedValue({ id: 'e-1' });
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([{ id: 'c-1', name: 'Hazmat Ops' }]);
  });

  it('records a reaction rating for the chosen member', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderModal(onSaved);

    expect(screen.getByText('Jordan Avery')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Overall rating/), '4');
    await user.click(screen.getByRole('button', { name: 'Record Evaluation' }));

    await waitFor(() =>
      expect(mockCreateEvaluation).toHaveBeenCalledWith({
        user_id: 'u-1',
        evaluation_level: 'reaction',
        course_id: undefined,
        overall_rating: 4,
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it('asks only for the fields of the chosen level', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(screen.getByLabelText('Level *'), 'learning');
    expect(screen.queryByLabelText(/Overall rating/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Pre-assessment/), '60');
    await user.type(screen.getByLabelText(/Post-assessment/), '85');
    await user.selectOptions(await screen.findByLabelText('Course'), 'c-1');
    await user.click(screen.getByRole('button', { name: 'Record Evaluation' }));

    await waitFor(() =>
      expect(mockCreateEvaluation).toHaveBeenCalledWith({
        user_id: 'u-1',
        evaluation_level: 'learning',
        course_id: 'c-1',
        pre_assessment_score: 60,
        post_assessment_score: 85,
      })
    );
  });

  it('files a results note under results', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(screen.getByLabelText('Level *'), 'results');
    await user.type(screen.getByLabelText('Results'), 'Fewer hose-line faults on calls');
    await user.click(screen.getByRole('button', { name: 'Record Evaluation' }));

    await waitFor(() =>
      expect(mockCreateEvaluation).toHaveBeenCalledWith({
        user_id: 'u-1',
        evaluation_level: 'results',
        course_id: undefined,
        results_notes: 'Fewer hose-line faults on calls',
      })
    );
  });
});
