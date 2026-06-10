import React from 'react';
import { LabelPrintPage } from '../../../components/labels/LabelPrintPage';

const ProspectLabelPrintPage: React.FC = () => (
  <LabelPrintPage
    module="prospective_members"
    title="Print Applicant Badges"
    backTo="/prospective-members"
    backLabel="Back to Prospective Members"
  />
);

export default ProspectLabelPrintPage;
