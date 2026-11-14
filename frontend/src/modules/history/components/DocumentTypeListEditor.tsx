/**
 * The department's managed list of document types (letter, minutes, newspaper
 * clipping, ...): an entry in use is retired or merged, never deleted. A
 * department starts with seven, made the first time the list is read.
 */
import React from 'react';
import { historyDocumentService } from '../services/api';
import { ManagedListEditor, type ManagedListApi } from './ManagedListEditor';

const TYPES: ManagedListApi = {
  list: () => historyDocumentService.listTypes(true),
  create: (name) => historyDocumentService.createType(name),
  setRetired: (id, retired) => historyDocumentService.updateType(id, { is_retired: retired }),
  merge: (id, intoId) => historyDocumentService.mergeType(id, intoId),
};

export const DocumentTypeListEditor: React.FC = () => (
  <ManagedListEditor
    title="Document types"
    description="How documents are sorted. A type in use cannot be deleted: retire it to stop offering it, or merge it into another."
    noun="document type"
    usage={['document', 'documents']}
    api={TYPES}
  />
);
