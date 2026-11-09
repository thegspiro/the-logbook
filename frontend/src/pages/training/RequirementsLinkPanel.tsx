/**
 * Settings & Data's way into the training requirements.
 *
 * The requirements are managed under Curriculum → Requirements; this panel
 * says what lives there and opens it, so an officer who looks for them among
 * the hub's settings finds them where they looked. It does not render the
 * requirements list a second time: one screen keeps one place to edit them.
 */

import React from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { REQUIREMENTS_HREF } from '../../components/training/trainingAdminAreas';

const MANAGED_THERE = [
  'The hours, shifts, certifications and courses each member owes, and how often',
  'Who each requirement applies to — every member, or particular membership types and positions',
  'Requirements imported from a registry (NFPA, Pro Board, NREMT) or started from a template',
];

const RequirementsLinkPanel: React.FC = () => (
  <div className="space-y-6 py-6">
    <div>
      <h2 className="text-theme-text-primary text-lg font-semibold">Requirements</h2>
      <p className="text-theme-text-secondary mt-1 text-sm">
        What members are graded against. Requirements are managed under Curriculum.
      </p>
    </div>

    <div className="card space-y-4 p-4">
      <ul className="text-theme-text-secondary list-disc space-y-1 pl-5 text-sm">
        {MANAGED_THERE.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Link to={REQUIREMENTS_HREF} className="btn-primary flex items-center gap-2">
          Open requirements
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  </div>
);

export default RequirementsLinkPanel;
