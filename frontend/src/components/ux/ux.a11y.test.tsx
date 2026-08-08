/**
 * Accessibility tests for the shared UX component library using vitest-axe.
 *
 * Each component is rendered in a representative state and checked for WCAG
 * violations (missing labels, invalid ARIA usage, broken roles). Add a case
 * here when adding a component to components/ux/.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { axe } from 'vitest-axe';
import { Users } from 'lucide-react';

import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { Pagination } from './Pagination';
import { Breadcrumbs } from './Breadcrumbs';
import { Collapsible } from './Collapsible';
import { ProgressSteps } from './ProgressSteps';
import { Tooltip } from './Tooltip';
import { Skeleton, SkeletonCard } from './Skeleton';

describe('UX component accessibility', () => {
  it('ConfirmDialog has no axe violations', async () => {
    const { container } = render(
      <ConfirmDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete record"
        message="This cannot be undone."
        variant="danger"
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('EmptyState has no axe violations', async () => {
    const { container } = render(
      <EmptyState
        icon={Users}
        title="No members yet"
        description="Add your first member to get started."
        actions={[{ label: 'Add member', onClick: () => {} }]}
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Pagination has no axe violations', async () => {
    const { container } = render(
      <Pagination currentPage={2} totalItems={120} pageSize={25} onPageChange={() => {}} onPageSizeChange={() => {}} />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Breadcrumbs has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/training/programs']}>
        <Breadcrumbs items={[{ label: 'Training', path: '/training' }, { label: 'Programs' }]} />
      </MemoryRouter>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Collapsible has no axe violations when closed', async () => {
    const { container } = render(
      <Collapsible title="Details">
        <p>Hidden content</p>
      </Collapsible>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Collapsible has no axe violations when open', async () => {
    const { container } = render(
      <Collapsible title="Details" defaultOpen>
        <p>Visible content</p>
      </Collapsible>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('ProgressSteps has no axe violations', async () => {
    const { container } = render(
      <ProgressSteps
        steps={[{ label: 'Profile', description: 'Basic info' }, { label: 'Contacts' }, { label: 'Review' }]}
        currentStep={1}
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Tooltip has no axe violations', async () => {
    const { container } = render(
      <Tooltip content="More information">
        <button type="button">Hover me</button>
      </Tooltip>
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Skeleton loading states have no axe violations', async () => {
    const { container } = render(
      <div>
        <Skeleton />
        <SkeletonCard />
      </div>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
