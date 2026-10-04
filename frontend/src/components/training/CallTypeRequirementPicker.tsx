/**
 * Which call types a calls requirement counts.
 *
 * Offers the department's one call-type list (Scheduling → Settings → General)
 * and stores slugs, so renaming a type cannot break a requirement. Nothing
 * selected means every call counts — the behaviour a calls requirement has
 * always had.
 *
 * The server matches a requirement against reports by type rather than by
 * spelling, so a slug chosen here credits reports that stored the type's label
 * (the call log, detailed tracking) as well as ones that stored the slug
 * (count-only close-out). A value already on the requirement that the list does
 * not know — typed before this picker existed — is kept as its own chip so it
 * can be seen and removed rather than dropped silently on save.
 */

import React from 'react';
import { Link } from 'react-router';
import { CallTypeChips } from '../../modules/scheduling/components/CallTypeChips';
import { orgCallTypeChoices } from '../../modules/scheduling/components/callTypeChoices';
import { useOrgCallTypes } from '../../modules/scheduling/hooks/useCallTypeLabels';

interface CallTypeRequirementPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export const CallTypeRequirementPicker: React.FC<CallTypeRequirementPickerProps> = ({ value, onChange }) => {
  const orgCallTypes = useOrgCallTypes();
  const choices = orgCallTypeChoices(orgCallTypes, value);
  const toggle = (slug: string) => onChange(value.includes(slug) ? value.filter((v) => v !== slug) : [...value, slug]);

  return (
    <div role="group" aria-label="Call types that count">
      <p className="text-theme-text-muted mb-1 block text-xs font-medium">Call types that count</p>
      <CallTypeChips choices={choices} selected={value} onToggle={toggle} />
      <p className="text-theme-text-muted mt-1 text-xs">
        {value.length === 0 ? 'None selected: every call counts. ' : 'Only calls of the selected types count. '}
        The list is the department&apos;s call types —{' '}
        <Link
          to="/scheduling/admin/settings/general"
          className="font-medium text-violet-700 hover:underline dark:text-violet-300"
        >
          add or rename them in Scheduling settings
        </Link>
        .
      </p>
    </div>
  );
};

export default CallTypeRequirementPicker;
