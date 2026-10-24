/**
 * Gate for the Skills Testing pages.
 *
 * A department runs Skills Testing or shift-report sign-offs, and the hub,
 * both navigation bars and My Training already hide Skills Testing from a
 * sign-offs department. A bookmark or a pasted link still reached the pages
 * themselves, where a member could start a test the department no longer
 * runs. This renders an explanation in their place instead.
 *
 * Not wrapped: a member's own past result and its print view. Switching
 * deletes nothing, and a result already on file stays readable.
 *
 * Not the enforcement either: the server refuses to open a new test for a
 * sign-offs department. So an unknown method (still loading aside) shows the
 * page, as the navigation does.
 *
 * Lives here rather than in routes.tsx so that file exports only its route
 * factory — mixing a component into it breaks Fast Refresh for the module.
 */

import React from 'react';
import { useNavigate } from 'react-router';
import { ClipboardCheck } from 'lucide-react';
import { EmptyState, SkeletonPage } from '../../../components/ux';
import { useAuthStore } from '../../../stores/authStore';
import {
  offersSkillsTesting,
  usePracticalSkillsMethod,
  usePracticalSkillsStore,
} from '../../../stores/practicalSkillsStore';

const SkillsTestingOff: React.FC = () => {
  const navigate = useNavigate();
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canConfigure = checkPermission('training.manage');

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <EmptyState
        icon={ClipboardCheck}
        headingLevel={1}
        title="Skills Testing is turned off"
        description="Your department records practical skills as sign-offs on shift reports, so skills tests are not taken here. Results already on file are kept."
        actions={
          canConfigure
            ? [
                {
                  label: 'Skill Evaluations',
                  onClick: () => void navigate('/training/admin?page=evaluations&tab=skill-evaluations'),
                },
                {
                  label: 'Practical skills setting',
                  variant: 'secondary',
                  onClick: () => void navigate('/training/admin?page=settings&tab=practical-skills'),
                },
              ]
            : [{ label: 'My Training', onClick: () => void navigate('/training/my-training') }]
        }
      />
    </div>
  );
};

export const SkillsTestingRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const method = usePracticalSkillsMethod();
  const organizationId = useAuthStore((s) => s.user?.organization_id ?? null);
  const loadedFor = usePracticalSkillsStore((s) => s.organizationId);

  // Wait for the answer rather than flash a page that is about to be replaced.
  if (organizationId && loadedFor !== organizationId) return <SkeletonPage showStats={false} />;
  if (!offersSkillsTesting(method)) return <SkillsTestingOff />;
  return <>{children}</>;
};

export default SkillsTestingRoute;
