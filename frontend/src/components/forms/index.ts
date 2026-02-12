/**
 * Cross-Module Form Components
 *
 * Reusable form building blocks that can be embedded in any module:
 * - Scheduling (shift checkout forms)
 * - Training (training update forms)
 * - Inventory (equipment inspection forms)
 * - Events (event feedback forms)
 * - Or any custom workflow
 *
 * Example usage in a module page:
 *
 *   import { FormRenderer, FormBuilder, SubmissionViewer } from '../components/forms';
 *
 *   // Render an existing form for submission
 *   <FormRenderer formId="uuid-of-form" onSubmitSuccess={(s) => handleDone(s)} />
 *
 *   // Build/edit form fields
 *   <FormBuilder formId="uuid-of-form" />
 *
 *   // View submissions
 *   <SubmissionViewer formId="uuid-of-form" allowDelete />
 */

export { default as FieldRenderer } from './FieldRenderer';
export type { FieldDefinition, FieldRendererProps } from './FieldRenderer';

export { default as FormRenderer } from './FormRenderer';
export type { FormRendererProps } from './FormRenderer';

export { default as FieldEditor } from './FieldEditor';
export type { FieldEditorProps } from './FieldEditor';

export { default as FormBuilder } from './FormBuilder';
export type { FormBuilderProps } from './FormBuilder';

export { default as SubmissionViewer } from './SubmissionViewer';
export type { SubmissionViewerProps } from './SubmissionViewer';
