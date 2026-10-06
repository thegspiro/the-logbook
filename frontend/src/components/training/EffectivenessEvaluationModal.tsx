/**
 * Effectiveness Evaluation Modal
 *
 * Records one Kirkpatrick evaluation of a member's training. Only the fields
 * for the chosen level are shown: a reaction rating, pre/post assessment
 * scores, an observed-behaviour rating, or a results note. The member is
 * chosen before this opens (MemberPickerModal), so the form never asks for a
 * raw member id.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../Modal';
import { trainingService } from '../../services/api';
import { effectivenessService } from '../../services/trainingServices';
import { getErrorMessage } from '../../utils/errorHandling';
import type { EvaluationLevel, TrainingCourse, TrainingEffectivenessCreate } from '../../types/training';

interface EffectivenessEvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  member: { userId: string; memberName: string } | null;
}

const LEVELS: { value: EvaluationLevel; label: string }[] = [
  { value: 'reaction', label: 'Level 1: Reaction' },
  { value: 'learning', label: 'Level 2: Learning' },
  { value: 'behavior', label: 'Level 3: Behavior' },
  { value: 'results', label: 'Level 4: Results' },
];

const toNumber = (value: string): number | undefined => (value.trim() === '' ? undefined : Number(value));

export const EffectivenessEvaluationModal: React.FC<EffectivenessEvaluationModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  member,
}) => {
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [saving, setSaving] = useState(false);
  const [level, setLevel] = useState<EvaluationLevel>('reaction');
  const [courseId, setCourseId] = useState('');
  const [overallRating, setOverallRating] = useState('');
  const [preScore, setPreScore] = useState('');
  const [postScore, setPostScore] = useState('');
  const [behaviorRating, setBehaviorRating] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLevel('reaction');
    setCourseId('');
    setOverallRating('');
    setPreScore('');
    setPostScore('');
    setBehaviorRating('');
    setNotes('');
    trainingService
      .getCourses()
      .then(setCourses)
      .catch(() => setCourses([]));
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!member) return;
    const data: TrainingEffectivenessCreate = {
      user_id: member.userId,
      evaluation_level: level,
      course_id: courseId || undefined,
    };
    if (level === 'reaction') data.overall_rating = toNumber(overallRating);
    if (level === 'learning') {
      data.pre_assessment_score = toNumber(preScore);
      data.post_assessment_score = toNumber(postScore);
    }
    if (level === 'behavior') {
      data.behavior_rating = toNumber(behaviorRating);
      data.behavior_observations = notes.trim() ? { notes: notes.trim() } : undefined;
    }
    if (level === 'results') data.results_notes = notes.trim() || undefined;

    setSaving(true);
    try {
      await effectivenessService.createEvaluation(data);
      toast.success('Evaluation recorded');
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to record the evaluation'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Submit Evaluation" size="md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          Member: <span className="text-theme-text-primary font-medium">{member?.memberName}</span>
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="eval-level">
              Level *
            </label>
            <select
              id="eval-level"
              className="form-input"
              value={level}
              onChange={(e) => setLevel(e.target.value as EvaluationLevel)}
            >
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="eval-course">
              Course
            </label>
            <select
              id="eval-course"
              className="form-input"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              <option value="">Not tied to a course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {level === 'reaction' && (
          <div>
            <label className="form-label" htmlFor="eval-rating">
              Overall rating (1–5) *
            </label>
            <input
              id="eval-rating"
              type="number"
              min={1}
              max={5}
              step={0.5}
              className="form-input"
              value={overallRating}
              onChange={(e) => setOverallRating(e.target.value)}
              required
            />
          </div>
        )}

        {level === 'learning' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="form-label" htmlFor="eval-pre">
                Pre-assessment score (0–100) *
              </label>
              <input
                id="eval-pre"
                type="number"
                min={0}
                max={100}
                className="form-input"
                value={preScore}
                onChange={(e) => setPreScore(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="form-label" htmlFor="eval-post">
                Post-assessment score (0–100) *
              </label>
              <input
                id="eval-post"
                type="number"
                min={0}
                max={100}
                className="form-input"
                value={postScore}
                onChange={(e) => setPostScore(e.target.value)}
                required
              />
            </div>
          </div>
        )}

        {level === 'behavior' && (
          <div>
            <label className="form-label" htmlFor="eval-behavior">
              Behavior rating (1–5) *
            </label>
            <input
              id="eval-behavior"
              type="number"
              min={1}
              max={5}
              step={0.5}
              className="form-input"
              value={behaviorRating}
              onChange={(e) => setBehaviorRating(e.target.value)}
              required
            />
          </div>
        )}

        {(level === 'behavior' || level === 'results') && (
          <div>
            <label className="form-label" htmlFor="eval-notes">
              {level === 'behavior' ? 'Observations' : 'Results'}
            </label>
            <textarea
              id="eval-notes"
              className="form-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              required={level === 'results'}
            />
          </div>
        )}

        <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
          <button
            type="button"
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2"
          >
            Cancel
          </button>
          <button type="submit" disabled={saving || !member} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : 'Record Evaluation'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default EffectivenessEvaluationModal;
