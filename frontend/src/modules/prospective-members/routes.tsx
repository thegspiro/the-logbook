/**
 * Prospective Members Module Routes
 *
 * This function returns route elements for the prospective members module.
 * To disable this module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React from 'react';
import { Route } from 'react-router-dom';
import {
  ProspectiveMembersPage,
  PipelineSettingsPage,
} from './pages';

export const getProspectiveMembersRoutes = () => {
  return (
    <React.Fragment>
      {/* Prospective Members Pipeline */}
      <Route path="/prospective-members" element={<ProspectiveMembersPage />} />

      {/* Pipeline Settings */}
      <Route path="/prospective-members/settings" element={<PipelineSettingsPage />} />
    </React.Fragment>
  );
};
