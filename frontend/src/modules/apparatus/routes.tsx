/**
 * Apparatus Module Routes
 *
 * This function returns route elements for the apparatus module.
 * To disable the apparatus module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import {
  ApparatusListPage,
  ApparatusDetailPage,
  ApparatusFormPage,
} from './pages';

export const getApparatusRoutes = () => {
  return (
    <React.Fragment>
      {/* Apparatus List */}
      <Route path="/apparatus" element={<ApparatusListPage />} />

      {/* Add New Apparatus */}
      <Route path="/apparatus/new" element={<ProtectedRoute requiredPermission="apparatus.manage"><ApparatusFormPage /></ProtectedRoute>} />

      {/* Apparatus Detail */}
      <Route path="/apparatus/:id" element={<ApparatusDetailPage />} />

      {/* Edit Apparatus */}
      <Route path="/apparatus/:id/edit" element={<ProtectedRoute requiredPermission="apparatus.manage"><ApparatusFormPage /></ProtectedRoute>} />
    </React.Fragment>
  );
};
