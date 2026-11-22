/**
 * The phase 5 managed lists: station names, apparatus types and event types.
 * An entry in use is retired or merged, never deleted; renaming one corrects
 * every record that uses it, which is how a misspelt station is fixed in one
 * place.
 */
import React from 'react';
import { historyListService, type ManagedListPath } from '../services/api';
import { ManagedListEditor, type ManagedListApi } from './ManagedListEditor';

const apiFor = (path: ManagedListPath): ManagedListApi => ({
  list: () => historyListService.list(path, true),
  create: (name) => historyListService.create(path, name),
  setRetired: (id, retired) => historyListService.update(path, id, { is_retired: retired }),
  merge: (id, intoId) => historyListService.merge(path, id, intoId),
});

const STATIONS = apiFor('stations');
const APPARATUS_TYPES = apiFor('apparatus-types');
const EVENT_TYPES = apiFor('event-types');

export const StationListEditor: React.FC = () => (
  <ManagedListEditor
    title="Stations"
    description="The department's firehouses, past and present, as events and unit numbers name them. Merge two names for the same place; a station in use is retired, not deleted."
    noun="station"
    usage={['use', 'uses']}
    api={STATIONS}
  />
);

export const ApparatusTypeListEditor: React.FC = () => (
  <ManagedListEditor
    title="Apparatus types"
    description="How historical apparatus are sorted. A type in use cannot be deleted: retire it to stop offering it, or merge it into another."
    noun="apparatus type"
    usage={['apparatus', 'apparatus']}
    api={APPARATUS_TYPES}
  />
);

export const EventTypeListEditor: React.FC = () => (
  <ManagedListEditor
    title="Event types"
    description="How events are sorted and filtered on the timeline. A type in use cannot be deleted: retire it, or merge it into another."
    noun="event type"
    usage={['event', 'events']}
    api={EVENT_TYPES}
  />
);
