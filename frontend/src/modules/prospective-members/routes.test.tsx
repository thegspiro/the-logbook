import { describe, it, expect } from 'vitest';
import React from 'react';
import { getProspectiveMembersRoutes } from './routes';

interface Guard {
  requiredAnyPermission?: string[];
  requiredPermission?: string;
}

/** The permission guard on the ProtectedRoute a route renders, looking through Suspense. */
function guardOf(path: string): Guard | undefined {
  let found: Guard | undefined;
  const findGuard = (node: React.ReactNode): void => {
    React.Children.forEach(node, (child) => {
      if (found || !React.isValidElement(child)) return;
      const props = child.props as Guard & { children?: React.ReactNode };
      if (props.requiredAnyPermission || props.requiredPermission) {
        found = props;
        return;
      }
      findGuard(props.children);
    });
  };
  const walk = (node: React.ReactNode): void => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { path?: string; element?: React.ReactNode; children?: React.ReactNode };
      if (props.path === path) findGuard(props.element);
      walk(props.children);
    });
  };
  walk(getProspectiveMembersRoutes());
  return found;
}

describe('getProspectiveMembersRoutes', () => {
  // The label API accepts view or manage; the page required view alone, so a
  // membership coordinator (manage only) was refused the page their own
  // pipeline's Print Labels button opens.
  it('opens applicant labels to view or manage, as the label API does', () => {
    expect(guardOf('/prospective-members/print-labels')).toEqual(
      expect.objectContaining({
        requiredAnyPermission: ['prospective_members.view', 'prospective_members.manage'],
      })
    );
  });
});
