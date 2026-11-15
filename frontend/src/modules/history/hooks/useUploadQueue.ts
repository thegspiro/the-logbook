/**
 * A queue of files sent one after another, each in its own request, so one
 * refused file (wrong type, too large, unreadable) does not stop the rest. The
 * server accepts 60 MB per request, so a batch cannot go in one.
 */
import { useState } from 'react';
import { getErrorMessage } from '../../../utils/errorHandling';

export type QueueState = 'waiting' | 'uploading' | 'done' | 'failed';

export interface QueueItem {
  key: string;
  file: File;
  state: QueueState;
  progress: number;
  error?: string | undefined;
  createdId?: string | undefined;
}

export const MAX_QUEUE_FILES = 25;

const newBatchId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

export const useUploadQueue = (
  precheck: (file: File) => string | null,
  send: (file: File, batchId: string, onProgress: (fraction: number) => void) => Promise<{ id: string }>
) => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [tooMany, setTooMany] = useState(false);

  const choose = (files: FileList | null) => {
    if (!files) return;
    const picked = Array.from(files);
    setTooMany(picked.length > MAX_QUEUE_FILES);
    setQueue(
      picked.slice(0, MAX_QUEUE_FILES).map((file, index) => {
        const problem = precheck(file);
        return {
          key: `${index}-${file.name}-${file.size}`,
          file,
          state: problem ? 'failed' : 'waiting',
          progress: 0,
          error: problem ?? undefined,
        };
      })
    );
  };

  const update = (key: string, changes: Partial<QueueItem>) =>
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));

  const start = async () => {
    setRunning(true);
    const batchId = newBatchId();
    for (const item of queue) {
      if (item.state !== 'waiting') continue;
      update(item.key, { state: 'uploading', progress: 0 });
      try {
        const created = await send(item.file, batchId, (fraction) => update(item.key, { progress: fraction }));
        update(item.key, { state: 'done', progress: 1, createdId: created.id });
      } catch (err: unknown) {
        update(item.key, { state: 'failed', error: getErrorMessage(err, 'Could not upload this file') });
      }
    }
    setRunning(false);
  };

  return {
    queue,
    running,
    tooMany,
    choose,
    start,
    waiting: queue.filter((q) => q.state === 'waiting').length,
    done: queue.filter((q) => q.state === 'done').length,
  };
};
