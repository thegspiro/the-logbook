/**
 * The Save row at the foot of a minutes settings panel.
 *
 * Shown only to someone who may change the setting (`settings.manage`); anyone
 * else reads the values the server applies. Nothing to save until something
 * changed, so Save never looks like it will do something when it will not.
 */

import React from 'react';

interface SettingsSaveBarProps {
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  /** False while the draft is something the server would refuse. */
  valid?: boolean;
}

export const SettingsSaveBar: React.FC<SettingsSaveBarProps> = ({ canEdit, dirty, saving, valid = true }) => {
  if (!canEdit) return null;
  return (
    <div className="border-theme-surface-border mt-5 flex items-center justify-end gap-3 border-t pt-4">
      {dirty && !saving && <span className="text-theme-text-muted text-xs">Unsaved changes</span>}
      <button type="submit" disabled={saving || !dirty || !valid} className="btn-primary">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
};

export default SettingsSaveBar;
