/**
 * The department's managed list of sources and donors, shared by photos and
 * documents: an entry in use is retired or merged, never deleted.
 */
import React from 'react';
import { historyMediaService } from '../services/api';
import { ManagedListEditor, type ManagedListApi } from './ManagedListEditor';

const SOURCES: ManagedListApi = {
  list: () => historyMediaService.listSources(true),
  create: (name) => historyMediaService.createSource(name),
  setRetired: (id, retired) => historyMediaService.updateSource(id, { is_retired: retired }),
  merge: (id, intoId) => historyMediaService.mergeSource(id, intoId),
};

export const SourceListEditor: React.FC = () => (
  <ManagedListEditor
    title="Sources and donors"
    description="Where photos, recordings and documents came from. A source in use cannot be deleted: retire it to stop offering it, or merge it into another to correct a duplicate."
    noun="source"
    usage={['item', 'items']}
    api={SOURCES}
  />
);
