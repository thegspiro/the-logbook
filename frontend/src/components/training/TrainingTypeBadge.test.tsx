import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrainingTypeBadge } from './TrainingComponents';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';

describe('TrainingTypeBadge — policy acknowledgments', () => {
  it('labels an acknowledgment as a policy, not with the certification fallback', () => {
    render(<TrainingTypeBadge type="policy_acknowledgment" />);

    expect(screen.getByText('Policy')).toBeInTheDocument();
    expect(screen.queryByText('Certification')).not.toBeInTheDocument();
  });

  it('has a full label for lists and reports', () => {
    expect(TRAINING_TYPE_LABELS.policy_acknowledgment).toBe('Policy Acknowledgment');
  });
});
