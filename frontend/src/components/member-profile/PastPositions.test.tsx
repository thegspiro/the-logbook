import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PastPositions } from './PastPositions';

const TZ = 'America/New_York';

describe('PastPositions', () => {
  it('names each earlier position with its dates, marking committees', () => {
    render(
      <PastPositions
        tz={TZ}
        positions={[
          {
            position_id: null,
            name: 'Old Board',
            kind: 'committee',
            started_at: '2023-03-04T12:00:00Z',
            ended_at: '2025-01-02T12:00:00Z',
          },
        ]}
      />
    );
    expect(screen.getByText('Earlier positions (1)')).toBeInTheDocument();
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Old Board (committee) · 3/4/2023 – 1/2/2025');
  });

  it('renders nothing for a member with no earlier positions', () => {
    const { container } = render(<PastPositions tz={TZ} positions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
