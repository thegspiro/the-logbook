import React from 'react';
import { LabelPrintPage } from '../components/labels/LabelPrintPage';

const MemberLabelPrintPage: React.FC = () => (
  <LabelPrintPage
    module="membership"
    title="Print Member Badges"
    backTo="/members"
    backLabel="Back to Members"
  />
);

export default MemberLabelPrintPage;
