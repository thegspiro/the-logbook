/**
 * Apparatus Module Routes
 *
 * This function returns route elements for the apparatus module.
 * To disable the apparatus module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React from 'react';
import { Route } from 'react-router-dom';
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
      <Route path="/apparatus/new" element={<ApparatusFormPage />} />

      {/* Apparatus Detail */}
      <Route path="/apparatus/:id" element={<ApparatusDetailPage />} />

      {/* Edit Apparatus */}
      <Route path="/apparatus/:id/edit" element={<ApparatusFormPage />} />
    </React.Fragment>
  );
};
