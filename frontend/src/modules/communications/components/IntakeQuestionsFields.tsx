/**
 * A suggestion box's intake questions, as a member answers them.
 *
 * Only the questions whose branch is taken are rendered; the parent form sends
 * only those answers (`answersToSend`). Checkbox answers are kept comma-joined,
 * the forms module's convention, which is what the shared visibility rule and
 * the server both read.
 */

import React from 'react';
import { SuggestionIntakeQuestionType } from '../../../constants/enums';
import type { IntakeQuestion } from '../types/suggestions';
import { savedQuestions, visibleQuestionIds } from '../utils/suggestionRouting';

// Mirror MAX_TEXT_ANSWER_LENGTH / MAX_TEXTAREA_ANSWER_LENGTH in
// backend/app/services/suggestion_intake.py, which enforce them.
const MAX_TEXT_LENGTH = 500;
const MAX_TEXTAREA_LENGTH = 5000;

interface IntakeQuestionsFieldsProps {
  questions: readonly IntakeQuestion[] | undefined;
  values: Readonly<Record<string, string>>;
  onChange: (questionId: string, value: string) => void;
}

function toggleChoice(current: string, value: string, checked: boolean): string {
  const chosen = current
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const next = checked ? [...new Set([...chosen, value])] : chosen.filter((v) => v !== value);
  return next.join(',');
}

const IntakeQuestionsFields: React.FC<IntakeQuestionsFieldsProps> = ({ questions, values, onChange }) => {
  const saved = savedQuestions(questions);
  if (saved.length === 0) return null;
  const visible = visibleQuestionIds(saved, values);

  return (
    <div className="space-y-4">
      {saved
        .filter((q) => visible.has(q.id))
        .map((question) => {
          const inputId = `intake-${question.id}`;
          const labelId = `${inputId}-label`;
          const helpId = question.helpText ? `${inputId}-help` : undefined;
          const value = values[question.id] ?? '';
          const label = (
            <>
              {question.label}
              {question.required && (
                <span className="text-theme-alert-danger-text" aria-hidden="true">
                  {' '}
                  *
                </span>
              )}
            </>
          );
          const help = question.helpText ? (
            <p id={helpId} className="text-theme-text-muted mt-1 text-xs">
              {question.helpText}
            </p>
          ) : null;

          if (
            question.type === SuggestionIntakeQuestionType.RADIO ||
            question.type === SuggestionIntakeQuestionType.CHECKBOX
          ) {
            const isRadio = question.type === SuggestionIntakeQuestionType.RADIO;
            const chosen = value.split(',').map((part) => part.trim());
            return (
              <fieldset key={question.id} aria-describedby={helpId}>
                <legend id={labelId} className="form-label">
                  {label}
                </legend>
                <div className="space-y-1">
                  {question.options.map((option) => (
                    <label
                      key={option.value}
                      className="text-theme-text-primary touch:min-h-[44px] flex items-center gap-2 text-sm"
                    >
                      <input
                        type={isRadio ? 'radio' : 'checkbox'}
                        name={inputId}
                        className="form-checkbox"
                        value={option.value}
                        checked={isRadio ? value === option.value : chosen.includes(option.value)}
                        required={isRadio && question.required}
                        onChange={(e) =>
                          onChange(
                            question.id,
                            isRadio ? option.value : toggleChoice(value, option.value, e.target.checked)
                          )
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                {help}
              </fieldset>
            );
          }

          return (
            <div key={question.id}>
              <label htmlFor={inputId} id={labelId} className="form-label">
                {label}
              </label>
              {question.type === SuggestionIntakeQuestionType.SELECT ? (
                <select
                  id={inputId}
                  className="form-input"
                  value={value}
                  required={question.required}
                  aria-describedby={helpId}
                  onChange={(e) => onChange(question.id, e.target.value)}
                >
                  <option value="">Choose…</option>
                  {question.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : question.type === SuggestionIntakeQuestionType.TEXTAREA ? (
                <textarea
                  id={inputId}
                  className="form-input"
                  rows={3}
                  value={value}
                  maxLength={MAX_TEXTAREA_LENGTH}
                  required={question.required}
                  aria-describedby={helpId}
                  onChange={(e) => onChange(question.id, e.target.value)}
                />
              ) : (
                <input
                  id={inputId}
                  className="form-input"
                  type={
                    question.type === SuggestionIntakeQuestionType.DATE
                      ? 'date'
                      : question.type === SuggestionIntakeQuestionType.NUMBER
                        ? 'number'
                        : 'text'
                  }
                  value={value}
                  maxLength={question.type === SuggestionIntakeQuestionType.TEXT ? MAX_TEXT_LENGTH : undefined}
                  required={question.required}
                  aria-describedby={helpId}
                  onChange={(e) => onChange(question.id, e.target.value)}
                />
              )}
              {help}
            </div>
          );
        })}
    </div>
  );
};

export default IntakeQuestionsFields;
