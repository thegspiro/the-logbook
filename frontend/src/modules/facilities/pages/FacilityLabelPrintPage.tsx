import React from 'react';
import { LabelPrintPage } from '../../../components/labels/LabelPrintPage';

const FacilityLabelPrintPage: React.FC = () => (
  <LabelPrintPage
    module="facilities"
    title="Print Facility Labels"
    backTo="/facilities"
    backLabel="Back to Facilities"
  />
);

export default FacilityLabelPrintPage;
