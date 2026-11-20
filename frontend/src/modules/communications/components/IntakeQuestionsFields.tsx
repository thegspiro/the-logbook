/**
 * A suggestion box's intake questions, as a member answers them.
 *
 * Only the questions whose branch is taken are rendered; the parent form sends
 * only those answers (`answersToSend`). Checkbox answers are kept comma-joined,
 * the forms module's convention, which is what the shared visibility rule and
 * the server both read.
 */

import React from 'react';
import { FIELD_ERROR_CLASS } from '../../../components/ux/FormField';
import { SuggestionIntakeQuestionType } from '../../../constants/enums';
import { usePickOptions } from '../hooks/usePickOptions';
import type { IntakeQuestion } from '../types/suggestions';
import { intakeInputId, savedQuestions, visibleQuestionIds } from '../utils/suggestionRouting';
import PickAnswerField from './PickAnswerField';

// Mirror MAX_TEXT_ANSWER_LENGTH / MAX_TEXTAREA_ANSWER_LENGTH in
// backend/app/services/suggestion_intake.py, which enforce them.
const MAX_TEXT_LENGTH = 500;
const MAX_TEXTAREA_LENGTH = 5000;
// Mirrors RATING_VALUES in backend/app/schemas/suggestion.py.
const RATING_VALUES = ['1', '2', '3', '4', '5'] as const;

interface IntakeQuestionsFieldsProps {
  questions: readonly IntakeQuestion[] | undefined;
  values: Readonly<Record<string, string>>;
  onChange: (questionId: string, value: string) => void;
  /** What is wrong with each answer, by question id, shown on its question. */
  errors?: Readonly<Record<string, string>> | undefined;
}

function toggleChoice(current: string, value: string, checked: boolean): string {
  const chosen = current
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const next = checked ? [...new Set([...chosen, value])] : chosen.filter((v) => v !== value);
  return next.join(',');
}

const IntakeQuestionsFields: React.FC<IntakeQuestionsFieldsProps> = ({ questions, values, onChange, errors = {} }) => {
  const saved = savedQuestions(questions);
  const asks = (type: string) => saved.some((q) => q.type === type);
  const members = usePickOptions('member', asks(SuggestionIntakeQuestionType.MEMBER));
  const vehicles = usePickOptions('apparatus', asks(SuggestionIntakeQuestionType.APPARATUS));
  if (saved.length === 0) return null;
  const visible = visibleQuestionIds(saved, values);

  return (
    <div className="space-y-4">
      {saved
        .filter((q) => visible.has(q.id))
        .map((question) => {
          const inputId = intakeInputId(question.id);
          const labelId = `${inputId}-label`;
          const error = errors[question.id];
          const errorId = error ? `${inputId}-error` : undefined;
          const helpId = question.helpText ? `${inputId}-help` : undefined;
          // Read on focus: the reason first, then the question's own help.
          const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;
          // aria-required rather than the native attribute: the form is
          // noValidate and names an unanswered question on the question
          // itself, where the browser's bubble named it and then vanished.
          const ariaRequired = question.required ? true : undefined;
          const ariaInvalid = error ? true : undefined;
          const value = values[question.id] ?? '';
          const label = (
            <>
              {question.label}
              {question.required && (
                <span className={FIELD_ERROR_CLASS} aria-hidden="true">
                  {' '}
                  *
                </span>
              )}
            </>
          );
          const errorText = error ? (
            <p id={errorId} className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
              {error}
            </p>
          ) : null;
          const help = question.helpText ? (
            <p id={helpId} className="text-theme-text-muted mt-1 text-xs">
              {question.helpText}
            </p>
          ) : null;

          if (
            question.type === SuggestionIntakeQuestionType.MEMBER ||
            question.type === SuggestionIntakeQuestionType.APPARATUS
          ) {
            const isMember = question.type === SuggestionIntakeQuestionType.MEMBER;
            return (
              <fieldset key={question.id} aria-describedby={describedBy}>
                <legend id={labelId} className="form-label">
                  {label}
                </legend>
                <PickAnswerField
                  inputId={inputId}
                  labelId={labelId}
                  helpId={describedBy}
                  invalid={Boolean(error)}
                  noun={isMember ? 'member' : 'vehicle'}
                  emptyMessage={
                    isMember
                      ? 'No members are on file to choose from.'
                      : 'No vehicles are on file, so you can skip this question.'
                  }
                  state={isMember ? members : vehicles}
                  value={value}
                  onChange={(next) => onChange(question.id, next)}
                />
                {errorText}
                {help}
              </fieldset>
            );
          }

          if (question.type === SuggestionIntakeQuestionType.RATING) {
            return (
              <fieldset
                key={question.id}
                aria-describedby={describedBy}
                aria-required={ariaRequired}
                aria-invalid={ariaInvalid}
              >
                <legend id={labelId} className="form-label">
                  {label}
                </legend>
                <div className="flex flex-wrap gap-4">
                  {RATING_VALUES.map((rating, index) => (
                    <label
                      key={rating}
                      className="text-theme-text-primary touch:min-h-[44px] flex items-center gap-1.5 text-sm"
                    >
                      <input
                        type="radio"
                        id={index === 0 ? inputId : undefined}
                        name={inputId}
                        className="form-checkbox"
                        value={rating}
                        checked={value === rating}
                        onChange={() => onChange(question.id, rating)}
                      />
                      {rating}
                    </label>
                  ))}
                </div>
                <p className="text-theme-text-muted mt-1 text-xs">1 is lowest, 5 is highest.</p>
                {errorText}
                {help}
              </fieldset>
            );
          }

          if (
            question.type === SuggestionIntakeQuestionType.RADIO ||
            question.type === SuggestionIntakeQuestionType.CHECKBOX
          ) {
            const isRadio = question.type === SuggestionIntakeQuestionType.RADIO;
            const chosen = value.split(',').map((part) => part.trim());
            return (
              <fieldset
                key={question.id}
                aria-describedby={describedBy}
                aria-required={ariaRequired}
                aria-invalid={ariaInvalid}
              >
                <legend id={labelId} className="form-label">
                  {label}
                </legend>
                <div className="space-y-1">
                  {question.options.map((option, index) => (
                    <label
                      key={option.value}
                      className="text-theme-text-primary touch:min-h-[44px] flex items-center gap-2 text-sm"
                    >
                      <input
                        type={isRadio ? 'radio' : 'checkbox'}
                        id={index === 0 ? inputId : undefined}
                        name={inputId}
                        className="form-checkbox"
                        value={option.value}
                        checked={isRadio ? value === option.value : chosen.includes(option.value)}
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
                {errorText}
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
                  aria-required={ariaRequired}
                  aria-invalid={ariaInvalid}
                  aria-describedby={describedBy}
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
                  aria-required={ariaRequired}
                  aria-invalid={ariaInvalid}
                  aria-describedby={describedBy}
                  onChange={(e) => onChange(question.id, e.target.value)}
                />
              ) : (
                <input
                  id={inputId}
                  className="form-input"
                  type={
                    question.type === SuggestionIntakeQuestionType.DATE
                      ? 'date'
                      : question.type === SuggestionIntakeQuestionType.TIME
                        ? 'time'
                        : question.type === SuggestionIntakeQuestionType.NUMBER
                          ? 'number'
                          : 'text'
                  }
                  value={value}
                  maxLength={question.type === SuggestionIntakeQuestionType.TEXT ? MAX_TEXT_LENGTH : undefined}
                  aria-required={ariaRequired}
                  aria-invalid={ariaInvalid}
                  aria-describedby={describedBy}
                  onChange={(e) => onChange(question.id, e.target.value)}
                />
              )}
              {errorText}
              {help}
            </div>
          );
        })}
    </div>
  );
};

export default IntakeQuestionsFields;
