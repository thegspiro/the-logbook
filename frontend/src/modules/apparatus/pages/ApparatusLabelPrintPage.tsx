import React from 'react';
import { LabelPrintPage } from '../../../components/labels/LabelPrintPage';

const ApparatusLabelPrintPage: React.FC = () => (
  <LabelPrintPage
    module="apparatus"
    title="Print Apparatus Labels"
    backTo="/apparatus"
    backLabel="Back to Apparatus"
  />
);

export default ApparatusLabelPrintPage;
