import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { KpiTile } from './KpiTile';

describe('KpiTile', () => {
  it('links the whole tile when given a destination', () => {
    renderWithRouter(
      <KpiTile
        label="Total Budgeted"
        value="$12,400"
        icon={<span />}
        iconBgClass="bg-green-100"
        linkTo="/finance/budgets"
      />
    );

    const link = screen.getByRole('link', { name: /Total Budgeted\s*\$12,400/ });
    expect(link).toHaveAttribute('href', '/finance/budgets');
    expect(screen.getByTestId('kpi-tile-chevron')).toBeInTheDocument();
  });

  it('renders a plain tile with no chevron when it leads nowhere', () => {
    renderWithRouter(<KpiTile label="Pending Approvals" value="3" icon={<span />} iconBgClass="bg-yellow-100" />);

    expect(screen.getByText('Pending Approvals')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kpi-tile-chevron')).not.toBeInTheDocument();
  });

  // Side by side, the icon and chevron squeezed the label to ~30px on a 320px
  // phone and ~57px beside the tablet sidebar. jsdom cannot measure that, so
  // this pins the classes that prevent it, which follow the tile's own width;
  // responsive-header-regressions.spec.ts measures it in a browser.
  it('stacks the icon above the label and pins the chevron in a narrow tile', () => {
    renderWithRouter(
      <KpiTile label="Dues Collection" value="84%" icon={<span />} iconBgClass="bg-purple-100" linkTo="/finance/dues" />
    );

    const layout = screen.getByTestId('kpi-tile-layout');
    expect(layout).toHaveClass('flex-col', '@[13rem]:flex-row');
    expect(layout).not.toHaveClass('sm:flex-row');
    expect(screen.getByTestId('kpi-tile-chevron')).toHaveClass('absolute', '@[13rem]:static');
  });
});
