import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Pencil, Send, Trash2, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { LEGAL_SECTIONS, toPlainText } from '../../../pages/legal/legalContent';
import { useAuthStore } from '../../../stores/authStore';
import { formatDateTime } from '../../../utils/dateFormatting';
import { RevisionEditorModal } from '../components/RevisionEditorModal';
import { useLegalDocumentsStore } from '../store/legalDocumentsStore';
import { LEGAL_DOCUMENT_LABEL, LegalDocumentType, type LegalDocumentState, type LegalRevision } from '../types/legal';

/**
 * Governance -> Legal Documents.
 *
 * The secretary and department leaders read what /privacy and /terms currently
 * publish and propose alternative wording for their own rules; publishing is
 * separately gated, so opening a proposal to review cannot change what the
 * public sees by accident.
 */

const DOCUMENT_ORDER: LegalDocumentType[] = [LegalDocumentType.PRIVACY_POLICY, LegalDocumentType.TERMS_OF_SERVICE];

interface EditorTarget {
  documentType: LegalDocumentType;
  revisionId?: string | undefined;
  body: string;
  changeNote: string;
  effectiveDate: string;
}

const RevisionCard: React.FC<{
  revision: LegalRevision;
  timezone: string;
  canPublish: boolean;
  canModify: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
}> = ({ revision, timezone, canPublish, canModify, onEdit, onDelete, onPublish }) => (
  <li className="card space-y-3 p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="text-theme-text-primary text-sm font-semibold">
        {revision.createdByName || 'A member'} proposed this
      </p>
      <p className="text-theme-text-muted text-xs">{formatDateTime(revision.updatedAt, timezone)}</p>
    </div>
    <p className="text-theme-text-secondary text-sm leading-6">{revision.changeNote}</p>
    {revision.effectiveDate ? (
      <p className="text-theme-text-muted text-xs">Effective date: {revision.effectiveDate}</p>
    ) : null}
    <details>
      <summary className="text-theme-accent-red cursor-pointer text-sm font-medium">Read the proposed text</summary>
      <pre className="text-theme-text-secondary bg-theme-surface-secondary mt-3 max-h-96 overflow-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
        {revision.body}
      </pre>
    </details>
    <div className="flex flex-wrap gap-2">
      {canModify ? (
        <>
          <button type="button" className="btn-icon flex items-center gap-2 px-3 text-sm" onClick={onEdit}>
            <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
          </button>
          <button type="button" className="btn-icon flex items-center gap-2 px-3 text-sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Discard
          </button>
        </>
      ) : null}
      {canPublish ? (
        <button type="button" className="btn-primary flex items-center gap-2 text-sm" onClick={onPublish}>
          <Send className="h-4 w-4" aria-hidden="true" /> Publish to members
        </button>
      ) : null}
    </div>
  </li>
);

const LegalDocumentsPage: React.FC = () => {
  const timezone = useTimezone();
  const { confirm } = useConfirm();
  const currentUser = useAuthStore((s) => s.user);
  const {
    overview,
    isLoading,
    isSaving,
    error,
    fetchOverview,
    createRevision,
    updateRevision,
    deleteRevision,
    publishRevision,
    revertToDefault,
  } = useLegalDocumentsStore();

  const [activeType, setActiveType] = useState<LegalDocumentType>(LegalDocumentType.PRIVACY_POLICY);
  const [editor, setEditor] = useState<EditorTarget | null>(null);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const orgName = overview?.organizationName || 'the department';
  const canPublish = overview?.canPublish ?? false;

  const documents = useMemo(() => {
    const byType = new Map<LegalDocumentType, LegalDocumentState>();
    for (const doc of overview?.documents ?? []) byType.set(doc.documentType, doc);
    return byType;
  }, [overview]);

  const active = documents.get(activeType);

  /**
   * Text a new proposal starts from.
   *
   * When custom text is live that is obviously the base. When the platform
   * default is live, seeding from the same source the public page renders is
   * what makes "propose an alternative" workable at all — retyping a
   * multi-section notice by hand is how a department ends up publishing one
   * that quietly drops the sections it never got to.
   */
  const seedBody = (documentType: LegalDocumentType): string => {
    const doc = documents.get(documentType);
    if (doc?.publishedBody) return doc.publishedBody;
    return toPlainText(LEGAL_SECTIONS[documentType], orgName);
  };

  const openNewRevision = (documentType: LegalDocumentType) => {
    setEditor({
      documentType,
      body: seedBody(documentType),
      changeNote: '',
      effectiveDate: documents.get(documentType)?.publishedEffectiveDate || '',
    });
  };

  const openEditRevision = (revision: LegalRevision) => {
    setEditor({
      documentType: revision.documentType,
      revisionId: revision.id,
      body: revision.body,
      changeNote: revision.changeNote,
      effectiveDate: revision.effectiveDate || '',
    });
  };

  const handleSave = async (values: { body: string; changeNote: string; effectiveDate: string }) => {
    if (!editor) return;
    try {
      if (editor.revisionId) {
        await updateRevision(editor.revisionId, {
          body: values.body,
          changeNote: values.changeNote,
          // Send the field even when cleared so the update is not read as
          // "leave it alone" — an omitted key means untouched on the backend.
          effectiveDate: values.effectiveDate || undefined,
        });
      } else {
        await createRevision({
          documentType: editor.documentType,
          body: values.body,
          changeNote: values.changeNote,
          effectiveDate: values.effectiveDate || undefined,
        });
      }
      toast.success('Draft saved. It is not public until it is published.');
      setEditor(null);
    } catch {
      toast.error('Could not save the draft');
    }
  };

  const handlePublish = async (revision: LegalRevision) => {
    const label = LEGAL_DOCUMENT_LABEL[revision.documentType];
    const confirmed = await confirm({
      title: `Publish the ${label}?`,
      message: `This replaces what every visitor to ${documents.get(revision.documentType)?.publicPath ?? ''} reads, immediately. The version published now will be archived, not deleted.`,
      confirmLabel: 'Publish it',
      cancelLabel: 'Not yet',
      variant: 'warning',
    });
    if (!confirmed) return;
    try {
      await publishRevision(revision.id);
      toast.success(`${label} published`);
    } catch {
      toast.error('Could not publish the revision');
    }
  };

  const handleDelete = async (revision: LegalRevision) => {
    const confirmed = await confirm({
      title: 'Discard this draft?',
      message: 'The proposed wording and its note are removed. Published versions are never affected.',
      confirmLabel: 'Discard it',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteRevision(revision.id);
      toast.success('Draft discarded');
    } catch {
      toast.error('Could not discard the draft');
    }
  };

  const handleRevert = async (doc: LegalDocumentState) => {
    const label = LEGAL_DOCUMENT_LABEL[doc.documentType];
    const confirmed = await confirm({
      title: `Go back to the built-in ${label}?`,
      message: `${doc.publicPath} will show the platform's default wording again. Your department's published version is archived here, not deleted.`,
      confirmLabel: 'Use the default',
      cancelLabel: 'Keep ours',
      variant: 'warning',
    });
    if (!confirmed) return;
    try {
      await revertToDefault(doc.documentType);
      toast.success(`${label} reverted to the built-in text`);
    } catch {
      toast.error('Could not revert the document');
    }
  };

  if (isLoading && !overview) return <SkeletonPage />;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-theme-text-primary text-2xl font-bold">Legal Documents</h1>
        <p className="text-theme-text-secondary mt-2 max-w-3xl text-sm leading-6">
          The privacy notice and terms of service published at {orgName}&rsquo;s public sign-in pages. Read what members
          see now, and propose wording that matches your bylaws, SOPs, and local law. A proposal is a draft — it changes
          nothing until it is published.
        </p>
      </header>

      {error ? (
        <p className="alert-danger text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="tab-scroll" role="tablist" aria-label="Legal documents">
        {DOCUMENT_ORDER.map((documentType) => (
          <button
            key={documentType}
            type="button"
            role="tab"
            aria-selected={activeType === documentType}
            className={`mobile-touch-target px-4 py-2 text-sm font-medium whitespace-nowrap ${
              activeType === documentType
                ? 'border-theme-accent-red text-theme-accent-red border-b-2'
                : 'text-theme-text-secondary'
            }`}
            onClick={() => setActiveType(documentType)}
          >
            {LEGAL_DOCUMENT_LABEL[documentType]}
          </button>
        ))}
      </div>

      {active ? (
        <div className="space-y-6">
          <section className="card space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-theme-text-primary text-lg font-semibold">What members see now</h2>
              <a
                href={active.publicPath}
                target="_blank"
                rel="noreferrer"
                className="text-theme-accent-red flex items-center gap-1 text-sm font-medium hover:underline"
              >
                Open {active.publicPath}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>

            {active.usingPlatformDefault ? (
              <p className="alert-info text-sm">
                The built-in {LEGAL_DOCUMENT_LABEL[active.documentType].toLowerCase()} is live. It is written for a
                fire-service deployment and already states that the department controls the system and that access
                follows a member&rsquo;s status. Proposing a revision starts you from that text.
              </p>
            ) : (
              <>
                <p className="text-theme-text-secondary text-sm">
                  {orgName} publishes its own wording
                  {active.publishedByName ? `, published by ${active.publishedByName}` : ''}
                  {active.publishedAt ? ` on ${formatDateTime(active.publishedAt, timezone)}` : ''}.
                  {active.publishedEffectiveDate
                    ? ` Members see “Last updated: ${active.publishedEffectiveDate}”.`
                    : ' No effective date is shown to members.'}
                </p>
                <details>
                  <summary className="text-theme-accent-red cursor-pointer text-sm font-medium">
                    Read the published text
                  </summary>
                  <pre className="text-theme-text-secondary bg-theme-surface-secondary mt-3 max-h-96 overflow-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                    {active.publishedBody}
                  </pre>
                </details>
              </>
            )}

            <p className="text-theme-text-muted text-xs">
              Published text replaces the built-in document entirely — the two are never merged, so anything you still
              want said (including the department-control and status-based-access language) has to be in your version.
              Have counsel review what you publish.
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="btn-primary flex items-center gap-2 text-sm"
                onClick={() => openNewRevision(active.documentType)}
              >
                <FileText className="h-4 w-4" aria-hidden="true" /> Propose a revision
              </button>
              {canPublish && !active.usingPlatformDefault ? (
                <button
                  type="button"
                  className="btn-icon flex items-center gap-2 px-3 text-sm"
                  onClick={() => void handleRevert(active)}
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" /> Revert to the built-in text
                </button>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-theme-text-primary text-lg font-semibold">
              Proposed revisions ({active.drafts.length})
            </h2>
            {active.drafts.length === 0 ? (
              <EmptyState
                title="No proposals yet"
                description="Propose a revision to suggest wording that fits your department's rules. Nothing is published until someone with publishing rights publishes it."
              />
            ) : (
              <ul className="space-y-3">
                {active.drafts.map((revision) => (
                  <RevisionCard
                    key={revision.id}
                    revision={revision}
                    timezone={timezone}
                    canPublish={canPublish}
                    canModify={canPublish || revision.createdBy === currentUser?.id}
                    onEdit={() => openEditRevision(revision)}
                    onDelete={() => void handleDelete(revision)}
                    onPublish={() => void handlePublish(revision)}
                  />
                ))}
              </ul>
            )}
          </section>

          {active.history.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-theme-text-primary text-lg font-semibold">Published history</h2>
              <p className="text-theme-text-secondary text-sm">
                What this page said before. Kept so the department can answer what a member was shown on a given date.
              </p>
              <ul className="space-y-3">
                {active.history.map((revision) => (
                  <li key={revision.id} className="card-secondary space-y-2 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-theme-text-primary text-sm font-semibold">
                        {revision.status === 'published' ? 'Live now' : 'Replaced'}
                        {revision.publishedByName ? ` — published by ${revision.publishedByName}` : ''}
                      </p>
                      <p className="text-theme-text-muted text-xs">{formatDateTime(revision.publishedAt, timezone)}</p>
                    </div>
                    <p className="text-theme-text-secondary text-sm leading-6">{revision.changeNote}</p>
                    <details>
                      <summary className="text-theme-accent-red cursor-pointer text-sm font-medium">
                        Read this version
                      </summary>
                      <pre className="text-theme-text-secondary bg-theme-surface mt-3 max-h-96 overflow-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                        {revision.body}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {editor ? (
        <RevisionEditorModal
          isOpen
          documentType={editor.documentType}
          editingRevisionId={editor.revisionId}
          initialValues={{
            body: editor.body,
            changeNote: editor.changeNote,
            effectiveDate: editor.effectiveDate,
          }}
          isSaving={isSaving}
          onCancel={() => setEditor(null)}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
};

export default LegalDocumentsPage;
