/**
 * Prospective Members Module Routes
 *
 * This function returns route elements for the prospective members module.
 * To disable this module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import {
  ProspectiveMembersPage,
  PipelineSettingsPage,
  ApplicationStatusPage,
} from './pages';

export const getProspectiveMembersRoutes = () => {
  return (
    <React.Fragment>
      {/* Prospective Members Pipeline */}
      <Route path="/prospective-members" element={<ProtectedRoute requiredPermission="prospective_members.manage"><ProspectiveMembersPage /></ProtectedRoute>} />

      {/* Pipeline Settings */}
      <Route path="/prospective-members/settings" element={<ProtectedRoute requiredPermission="prospective_members.manage"><PipelineSettingsPage /></ProtectedRoute>} />

      {/* Public Application Status (no auth required) */}
      <Route path="/application-status/:token" element={<ApplicationStatusPage />} />
    </React.Fragment>
  );
};
