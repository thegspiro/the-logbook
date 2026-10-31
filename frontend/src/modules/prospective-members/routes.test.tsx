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
  // The page asks what the label API accepts, so the pipeline's Print Badges
  // button never opens a page the API then refuses. Since per-applicant access
  // that is view_all alone: a label names applicants by id, and without it a
  // member sees only the applicants assigned to them.
  it('opens applicant labels to view_all, as the label API does', () => {
    expect(guardOf('/prospective-members/print-labels')).toEqual(
      expect.objectContaining({ requiredPermission: 'prospective_members.view_all' })
    );
  });

  // An interviewer assigned to the applicant (a board member, a trustee) holds
  // no pipeline permission; the backend admits them per applicant.
  it('leaves the interview and My Applicants pages to the server to admit', () => {
    for (const path of ['/prospective-members/:applicantId/interview', '/prospective-members/my-applicants']) {
      // guardOf finds only a guard that names a permission.
      expect(guardOf(path)).toBeUndefined();
    }
  });
});
