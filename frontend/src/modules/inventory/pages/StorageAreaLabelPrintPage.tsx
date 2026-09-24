import React from 'react';
import { LabelPrintPage } from '../../../components/labels/LabelPrintPage';

const StorageAreaLabelPrintPage: React.FC = () => (
  <LabelPrintPage
    module="storage_areas"
    title="Print Storage Area Labels"
    backTo="/inventory/storage-areas"
    backLabel="Back to Storage Areas"
  />
);

export default StorageAreaLabelPrintPage;
