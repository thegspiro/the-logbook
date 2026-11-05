/**
 * Settings & Data's way into the compliance configuration screen.
 *
 * The screen is its own route (`/training/compliance-config`) rather than a
 * hub panel, because officers outside Training Administration reach it too:
 * compliance officers and elected officers hold `compliance.manage` without
 * `training.manage`. This panel says what lives there and opens it, so the
 * officer looking under Settings & Data finds it where they looked.
 */

import React from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { COMPLIANCE_CONFIG_HREF } from '../../components/training/trainingAdminAreas';

const CONFIGURED_THERE = [
  'The department-wide compliance threshold — a percentage, or every requirement met',
  'Compliance profiles for particular membership types and positions, with their own thresholds',
  'Scheduled compliance reports — monthly, quarterly or yearly — and who they are emailed to',
];

const ComplianceSettingsPanel: React.FC = () => (
  <div className="space-y-6 py-6">
    <div>
      <h2 className="text-theme-text-primary text-lg font-semibold">Compliance settings</h2>
      <p className="text-theme-text-secondary mt-1 text-sm">
        How the department decides who is compliant. These settings open on their own page.
      </p>
    </div>

    <div className="card space-y-4 p-4">
      <ul className="text-theme-text-secondary list-disc space-y-1 pl-5 text-sm">
        {CONFIGURED_THERE.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="text-theme-text-secondary text-sm">
        The requirements members are graded against are set under Curriculum → Requirements.
      </p>
      <div className="flex justify-end">
        <Link to={COMPLIANCE_CONFIG_HREF} className="btn-primary flex items-center gap-2">
          Open compliance settings
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  </div>
);

export default ComplianceSettingsPanel;
