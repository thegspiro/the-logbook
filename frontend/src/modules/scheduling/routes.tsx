/**
 * Scheduling Module Routes
 *
 * Returns route elements for the scheduling/shifts module.
 */

import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const SchedulingPage = lazyWithRetry(
  () => import('../../pages/SchedulingPage'),
);

const EquipmentCheckTemplateBuilder = lazyWithRetry(
  () => import('../../pages/scheduling/EquipmentCheckTemplateBuilder'),
);

const EquipmentCheckReportsPage = lazyWithRetry(
  () => import('../../pages/scheduling/EquipmentCheckReportsPage'),
);

export const getSchedulingRoutes = () => {
  return (
    <React.Fragment>
      <Route
        path="/scheduling"
        element={
          <Suspense fallback={null}>
            <SchedulingPage />
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment-check-templates/new"
        element={
          <Suspense fallback={null}>
            <EquipmentCheckTemplateBuilder />
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment-check-templates/:templateId"
        element={
          <Suspense fallback={null}>
            <EquipmentCheckTemplateBuilder />
          </Suspense>
        }
      />
      <Route
        path="/scheduling/equipment-check-reports"
        element={
          <Suspense fallback={null}>
            <EquipmentCheckReportsPage />
          </Suspense>
        }
      />
    </React.Fragment>
  );
};
