/**
 * Follow up on an anonymous submission with its key.
 *
 * The key lives only in this component's state. It is never written to
 * storage or put in the URL, and it is cleared when the member leaves.
 */

import React, { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, Loader2 } from 'lucide-react';
import { getErrorMessage } from '../../../utils/errorHandling';
import { suggestionsService } from '../services/suggestionsService';
import type { SubmitterSuggestionDetail } from '../types/suggestions';
import SubmitterSuggestionView from './SubmitterSuggestionView';

const FollowUpKeyPanel: React.FC = () => {
  const [keyInput, setKeyInput] = useState('');
  const [activeKey, setActiveKey] = useState('');
  const [detail, setDetail] = useState<SubmitterSuggestionDetail | null>(null);
  const [isLooking, setIsLooking] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    setIsLooking(true);
    setNotFound(false);
    try {
      setDetail(await suggestionsService.lookupByKey(key));
      setActiveKey(key);
    } catch {
      setDetail(null);
      setActiveKey('');
      setNotFound(true);
    } finally {
      setIsLooking(false);
    }
  };

  const loadAttachment = useCallback(
    (attachmentId: string) => suggestionsService.getAttachmentByKey(activeKey, attachmentId),
    [activeKey]
  );

  const reply = async (body: string) => {
    try {
      setDetail(await suggestionsService.replyByKey(activeKey, body));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to send your reply.'));
      throw err;
    }
  };

  const close = () => {
    setDetail(null);
    setActiveKey('');
    setKeyInput('');
  };

  return (
    <div className="space-y-4">
      {!detail && (
        <form onSubmit={(e) => void lookup(e)} className="card space-y-3 p-4 sm:p-6">
          <p className="text-theme-text-secondary text-sm">
            Enter the follow-up key you were given when you submitted anonymously. It shows the status and any replies,
            and lets you respond — without your name being attached.
          </p>
          <label htmlFor="follow-up-key" className="form-label">
            Follow-up key
          </label>
          <input
            id="follow-up-key"
            className="form-input font-mono"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
          />
          {notFound && (
            <p role="alert" className="alert-danger text-sm">
              No submission matches that key. Check it was copied in full.
            </p>
          )}
          <button
            type="submit"
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 disabled:opacity-60"
            disabled={isLooking || keyInput.trim().length < 20}
          >
            {isLooking ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            )}
            Open submission
          </button>
        </form>
      )}
      {detail && (
        <>
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={close}>
            Close and forget key
          </button>
          <SubmitterSuggestionView detail={detail} loadAttachment={loadAttachment} onReply={reply} />
        </>
      )}
    </div>
  );
};

export default FollowUpKeyPanel;
