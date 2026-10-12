/**
 * Knowledge Tests — officers write online tests and their question banks.
 *
 * Rendered as Training Admin → Setup → Knowledge Tests. A published test is
 * taken by members at /training/knowledge-tests; the server grades it and
 * records the score on the linked knowledge-test requirement, the same way an
 * officer's typed-in score is recorded.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpenCheck, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/Modal';
import { EmptyState } from '../../components/ux/EmptyState';
import { useConfirm } from '../../contexts/ConfirmContext';
import { trainingProgramService } from '../../services/api';
import { knowledgeTestService } from '../../services/knowledgeTestService';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import {
  newQuestion,
  questionFrom,
  questionProblem,
  trueFalseOptions,
  type QuestionForm,
} from '../../utils/knowledgeTestForm';
import type { TrainingRequirementEnhanced } from '../../types/training';
import type {
  KnowledgeAttemptSummary,
  KnowledgeQuestionAdmin,
  KnowledgeQuestionType,
  KnowledgeQuestionWrite,
  KnowledgeTest,
  KnowledgeTestDetail,
} from '../../types/knowledgeTest';

interface SettingsForm {
  name: string;
  description: string;
  instructions: string;
  requirementId: string;
  passingScore: string;
  timeLimit: string;
  questionCount: string;
  shuffle: boolean;
  showAnswers: boolean;
}

const emptySettings: SettingsForm = {
  name: '',
  description: '',
  instructions: '',
  requirementId: '',
  passingScore: '',
  timeLimit: '',
  questionCount: '',
  shuffle: true,
  showAnswers: false,
};

function settingsFrom(test: KnowledgeTest): SettingsForm {
  return {
    name: test.name,
    description: test.description ?? '',
    instructions: test.instructions ?? '',
    requirementId: test.requirement_id ?? '',
    passingScore: test.passing_score?.toString() ?? '',
    timeLimit: test.time_limit_minutes?.toString() ?? '',
    questionCount: test.question_count?.toString() ?? '',
    shuffle: test.shuffle_questions,
    showAnswers: test.show_correct_answers,
  };
}

const numberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

const TestEditor: React.FC<{ testId: string; onBack: () => void }> = ({ testId, onBack }) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [test, setTest] = useState<KnowledgeTestDetail | null>(null);
  const [attempts, setAttempts] = useState<KnowledgeAttemptSummary[]>([]);
  const [editing, setEditing] = useState<KnowledgeQuestionAdmin | 'new' | null>(null);
  const [form, setForm] = useState<QuestionForm>(newQuestion());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, list] = await Promise.all([
        knowledgeTestService.get(testId),
        knowledgeTestService.listAttempts(testId),
      ]);
      setTest(detail as KnowledgeTestDetail);
      setAttempts(list);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load the test'));
    }
  }, [testId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openQuestion = (q: KnowledgeQuestionAdmin | 'new') => {
    setForm(q === 'new' ? newQuestion() : questionFrom(q));
    setEditing(q);
  };

  const setType = (type: KnowledgeQuestionType) => {
    if (type === 'true_false') {
      setForm({ ...form, type, options: trueFalseOptions(true) });
    } else if (form.type === 'true_false') {
      setForm({ ...form, type, options: newQuestion().options });
    } else if (type === 'single_choice' && form.options.filter((o) => o.correct).length > 1) {
      // Keep only the first marked answer when narrowing to one.
      let seen = false;
      setForm({
        ...form,
        type,
        options: form.options.map((o) => {
          const keep = o.correct && !seen;
          if (o.correct) seen = true;
          return { ...o, correct: keep };
        }),
      });
    } else {
      setForm({ ...form, type });
    }
  };

  const markCorrect = (index: number) => {
    setForm({
      ...form,
      options: form.options.map((o, i) =>
        form.type === 'multiple_choice'
          ? i === index
            ? { ...o, correct: !o.correct }
            : o
          : { ...o, correct: i === index }
      ),
    });
  };

  const saveQuestion = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const problem = questionProblem(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    const payload: KnowledgeQuestionWrite = {
      prompt: form.prompt.trim(),
      question_type: form.type,
      options: form.options.map((o) => ({ id: o.id, text: o.text.trim(), correct: o.correct })),
      explanation: form.explanation.trim() || null,
      points: Number(form.points),
      active: form.active,
    };
    setSaving(true);
    try {
      const updated =
        editing === 'new'
          ? await knowledgeTestService.addQuestion(testId, payload)
          : editing
            ? await knowledgeTestService.replaceQuestion(testId, editing.id, payload)
            : null;
      if (updated) setTest(updated);
      setEditing(null);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the question'));
    } finally {
      setSaving(false);
    }
  };

  const removeQuestion = async (q: KnowledgeQuestionAdmin) => {
    const ok = await confirm({
      title: 'Delete question?',
      message: 'Members who were already given it keep their copy; nobody new will be asked it.',
      confirmLabel: 'Delete question',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      setTest(await knowledgeTestService.deleteQuestion(testId, q.id));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete the question'));
    }
  };

  const setStatus = async (status: 'draft' | 'published' | 'archived') => {
    try {
      setTest(await knowledgeTestService.update(testId, { status }));
      toast.success(status === 'published' ? 'Published' : status === 'archived' ? 'Archived' : 'Moved back to draft');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to change the status'));
    }
  };

  if (!test) {
    return (
      <div className="flex h-32 items-center justify-center" role="status">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading test</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button type="button" className="btn-secondary" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All tests
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-theme-text-primary text-lg font-semibold">{test.name}</h2>
          <p className="text-theme-text-secondary text-sm">
            {test.status} · {test.active_question_count} active question{test.active_question_count === 1 ? '' : 's'}
            {test.question_count ? ` · ${test.question_count} drawn per attempt` : ''} · pass at{' '}
            {test.effective_passing_score}%
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {test.status !== 'published' && (
            <button type="button" className="btn-primary" onClick={() => void setStatus('published')}>
              Publish
            </button>
          )}
          {test.status === 'published' && (
            <button type="button" className="btn-secondary" onClick={() => void setStatus('draft')}>
              Unpublish
            </button>
          )}
          {test.status !== 'archived' && (
            <button type="button" className="btn-secondary" onClick={() => void setStatus('archived')}>
              Archive
            </button>
          )}
        </div>
      </div>

      <section className="space-y-2" aria-labelledby="kt-questions">
        <div className="flex items-center justify-between gap-2">
          <h3 id="kt-questions" className="text-theme-text-primary font-semibold">
            Questions
          </h3>
          <button type="button" className="btn-primary" onClick={() => openQuestion('new')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add question
          </button>
        </div>
        {test.questions.length === 0 ? (
          <p className="text-theme-text-muted text-sm">No questions yet. A test needs at least one to publish.</p>
        ) : (
          <ol className="space-y-2">
            {test.questions.map((q, i) => (
              <li key={q.id} className="card flex flex-wrap items-start justify-between gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary text-sm font-medium break-words">
                    {i + 1}. {q.prompt}
                  </p>
                  <p className="text-theme-text-muted text-xs">
                    {q.question_type.replace('_', ' ')} · {q.points} pt{q.points === 1 ? '' : 's'}
                    {q.active ? '' : ' · inactive'} · answer:{' '}
                    {q.options
                      .filter((o) => o.correct)
                      .map((o) => o.text)
                      .join(', ')}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Edit question ${i + 1}`}
                    onClick={() => openQuestion(q)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Delete question ${i + 1}`}
                    onClick={() => void removeQuestion(q)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="kt-results">
        <h3 id="kt-results" className="text-theme-text-primary font-semibold">
          Results
        </h3>
        {attempts.length === 0 ? (
          <p className="text-theme-text-muted text-sm">Nobody has taken this test yet.</p>
        ) : (
          <table className="rwd-table w-full text-sm">
            <thead>
              <tr className="text-theme-text-muted text-left">
                <th scope="col">Member</th>
                <th scope="col">Started</th>
                <th scope="col">Score</th>
                <th scope="col">Requirement</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} className="border-theme-surface-border border-t">
                  <td data-label="Member">{a.user_name ?? '—'}</td>
                  <td data-label="Started">{formatDateTime(a.started_at, tz)}</td>
                  <td data-label="Score">
                    {a.status === 'in_progress' ? 'In progress' : `${a.score ?? 0}% ${a.passed ? '(pass)' : '(fail)'}`}
                  </td>
                  <td data-label="Requirement">{a.credited ? 'Recorded' : (a.credit_note ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Modal
        isOpen={editing !== null}
        onClose={() => {
          if (!saving) setEditing(null);
        }}
        title={editing === 'new' ? 'Add question' : 'Edit question'}
        size="lg"
        onSubmit={(e) => void saveQuestion(e)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              Save question
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="kt-prompt" className="form-label">
              Question
            </label>
            <textarea
              id="kt-prompt"
              className="form-input"
              rows={3}
              required
              maxLength={5000}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="kt-type" className="form-label">
              Type
            </label>
            <select
              id="kt-type"
              className="form-input"
              value={form.type}
              onChange={(e) => setType(e.target.value as KnowledgeQuestionType)}
            >
              <option value="single_choice">One correct answer</option>
              <option value="multiple_choice">Several correct answers</option>
              <option value="true_false">True / false</option>
            </select>
          </div>
          <fieldset className="space-y-2">
            <legend className="form-label">
              Options — mark the correct answer{form.type === 'multiple_choice' ? 's' : ''}
            </legend>
            {form.options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type={form.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                  name="kt-correct"
                  className="form-checkbox"
                  aria-label={`Option ${index + 1} is correct`}
                  checked={option.correct}
                  onChange={() => markCorrect(index)}
                />
                <input
                  className="form-input"
                  aria-label={`Option ${index + 1}`}
                  value={option.text}
                  maxLength={1000}
                  readOnly={form.type === 'true_false'}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      options: form.options.map((o, i) => (i === index ? { ...o, text: e.target.value } : o)),
                    })
                  }
                />
                {form.type !== 'true_false' && form.options.length > 2 && (
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() => setForm({ ...form, options: form.options.filter((_, i) => i !== index) })}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            {form.type !== 'true_false' && form.options.length < 10 && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setForm({ ...form, options: [...form.options, { text: '', correct: false }] })}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add option
              </button>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="kt-points" className="form-label">
                Points
              </label>
              <input
                id="kt-points"
                type="number"
                min={0.5}
                step={0.5}
                className="form-input"
                value={form.points}
                onChange={(e) => setForm({ ...form, points: e.target.value })}
              />
            </div>
            <label className="text-theme-text-primary touch:min-h-11 flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Ask this question
            </label>
          </div>
          <div>
            <label htmlFor="kt-explanation" className="form-label">
              Explanation shown after submitting (optional)
            </label>
            <textarea
              id="kt-explanation"
              className="form-input"
              rows={2}
              maxLength={5000}
              value={form.explanation}
              onChange={(e) => setForm({ ...form, explanation: e.target.value })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

const KnowledgeTestsTab: React.FC = () => {
  const { confirm } = useConfirm();
  const [tests, setTests] = useState<KnowledgeTest[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirementEnhanced[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<KnowledgeTest | 'new' | null>(null);
  const [form, setForm] = useState<SettingsForm>(emptySettings);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTests(await knowledgeTestService.list());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load knowledge tests'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      try {
        const all = await trainingProgramService.getRequirementsEnhanced({ requirement_type: 'knowledge_test' });
        setRequirements(all.filter((r) => r.requirement_type === 'knowledge_test'));
      } catch {
        // The link is optional; the field just offers nothing.
      }
    })();
  }, [load]);

  const openSettings = (test: KnowledgeTest | 'new') => {
    setForm(test === 'new' ? emptySettings : settingsFrom(test));
    setSettingsFor(test);
  };

  const saveSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      if (settingsFor === 'new') {
        // Create: blank optional fields are omitted (Pitfall #1).
        const created = await knowledgeTestService.create({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          instructions: form.instructions.trim() || undefined,
          requirement_id: form.requirementId || undefined,
          passing_score: numberOrNull(form.passingScore) ?? undefined,
          time_limit_minutes: numberOrNull(form.timeLimit) ?? undefined,
          question_count: numberOrNull(form.questionCount) ?? undefined,
          shuffle_questions: form.shuffle,
          show_correct_answers: form.showAnswers,
        });
        setSettingsFor(null);
        setSelected(created.id);
      } else if (settingsFor) {
        // Update: everything the form owns, cleared fields as null.
        await knowledgeTestService.update(settingsFor.id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          instructions: form.instructions.trim() || null,
          requirement_id: form.requirementId || null,
          passing_score: numberOrNull(form.passingScore),
          time_limit_minutes: numberOrNull(form.timeLimit),
          question_count: numberOrNull(form.questionCount),
          shuffle_questions: form.shuffle,
          show_correct_answers: form.showAnswers,
        });
        setSettingsFor(null);
      }
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the test'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (test: KnowledgeTest) => {
    const ok = await confirm({
      title: 'Delete test?',
      message: `"${test.name}" and its questions will be deleted. This cannot be undone.`,
      confirmLabel: 'Delete test',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await knowledgeTestService.remove(test.id);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete the test'));
    }
  };

  if (selected) {
    return (
      <div className="py-6">
        <TestEditor
          testId={selected}
          onBack={() => {
            setSelected(null);
            void load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-theme-text-primary text-lg font-semibold">Knowledge Tests</h2>
          <p className="text-theme-text-secondary text-sm">
            Written tests members take online. The score is graded on submission and recorded on the linked
            knowledge-test requirement, the same as a score you enter by hand.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => openSettings('new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New test
        </button>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center" role="status">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading</span>
        </div>
      ) : tests.length === 0 ? (
        <EmptyState
          icon={BookOpenCheck}
          title="No knowledge tests yet"
          description="Create a test, add its questions, and publish it for members to take."
          actions={[{ label: 'New test', onClick: () => openSettings('new'), icon: Plus }]}
        />
      ) : (
        <ul className="card-grid">
          {tests.map((test) => (
            <li key={test.id} className="card flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-theme-text-primary font-semibold break-words">{test.name}</h3>
                <span className="badge bg-theme-surface-secondary text-theme-text-secondary">{test.status}</span>
              </div>
              <p className="text-theme-text-secondary text-sm">
                {test.active_question_count} question{test.active_question_count === 1 ? '' : 's'} ·{' '}
                {test.attempt_count} attempt{test.attempt_count === 1 ? '' : 's'} · pass at{' '}
                {test.effective_passing_score}%
              </p>
              {test.requirement_name && (
                <p className="text-theme-text-muted text-xs">Counts toward: {test.requirement_name}</p>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <button type="button" className="btn-primary" onClick={() => setSelected(test.id)}>
                  Questions &amp; results
                </button>
                <button type="button" className="btn-secondary" onClick={() => openSettings(test)}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Settings
                </button>
                {test.attempt_count === 0 && (
                  <button type="button" className="btn-secondary" onClick={() => void remove(test)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={settingsFor !== null}
        onClose={() => {
          if (!saving) setSettingsFor(null);
        }}
        title={settingsFor === 'new' ? 'New knowledge test' : 'Test settings'}
        size="lg"
        onSubmit={(e) => void saveSettings(e)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => setSettingsFor(null)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              Save
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="kt-name" className="form-label">
              Name
            </label>
            <input
              id="kt-name"
              className="form-input"
              required
              maxLength={255}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="kt-description" className="form-label">
              Description (optional)
            </label>
            <textarea
              id="kt-description"
              className="form-input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="kt-instructions" className="form-label">
              Instructions shown while taking it (optional)
            </label>
            <textarea
              id="kt-instructions"
              className="form-input"
              rows={2}
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="kt-requirement" className="form-label">
              Counts toward requirement (optional)
            </label>
            <select
              id="kt-requirement"
              className="form-input"
              value={form.requirementId}
              onChange={(e) => setForm({ ...form, requirementId: e.target.value })}
            >
              <option value="">None</option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="kt-passing" className="form-label">
                Passing score %
              </label>
              <input
                id="kt-passing"
                type="number"
                min={0}
                max={100}
                className="form-input"
                placeholder="Requirement's, else 70"
                value={form.passingScore}
                onChange={(e) => setForm({ ...form, passingScore: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="kt-time" className="form-label">
                Time limit (minutes)
              </label>
              <input
                id="kt-time"
                type="number"
                min={1}
                max={600}
                className="form-input"
                placeholder="None"
                value={form.timeLimit}
                onChange={(e) => setForm({ ...form, timeLimit: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="kt-count" className="form-label">
                Questions per attempt
              </label>
              <input
                id="kt-count"
                type="number"
                min={1}
                className="form-input"
                placeholder="All"
                value={form.questionCount}
                onChange={(e) => setForm({ ...form, questionCount: e.target.value })}
              />
            </div>
          </div>
          <label className="text-theme-text-primary touch:min-h-11 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.shuffle}
              onChange={(e) => setForm({ ...form, shuffle: e.target.checked })}
            />
            Shuffle questions and options for each attempt
          </label>
          <label className="text-theme-text-primary touch:min-h-11 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.showAnswers}
              onChange={(e) => setForm({ ...form, showAnswers: e.target.checked })}
            />
            Show members the correct answers after they submit
          </label>
        </div>
      </Modal>
    </div>
  );
};

export default KnowledgeTestsTab;
