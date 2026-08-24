import React from 'react';

/**
 * The card and label shell the submit screen is built from. The overline is
 * the sidenav's ADMINISTRATION divider treatment reused as a section label.
 */
export const Overline: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-theme-text-muted text-[10px] font-bold tracking-[0.12em] uppercase">{children}</p>
);

export const SectionCard: React.FC<{ title: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  action,
  children,
}) => (
  <section className="card flex flex-col gap-3.5 p-4 sm:p-5">
    <div className="flex items-center justify-between gap-3">
      <Overline>{title}</Overline>
      {action}
    </div>
    {children}
  </section>
);

export const FieldLabel: React.FC<{
  htmlFor: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}> = ({ htmlFor, required, optional, children }) => (
  <label htmlFor={htmlFor} className="form-label">
    {children}
    {required && (
      <span className="text-red-700 dark:text-red-400" aria-hidden="true">
        {' '}
        *
      </span>
    )}
    {optional && <span className="text-theme-text-muted font-normal"> optional</span>}
  </label>
);
