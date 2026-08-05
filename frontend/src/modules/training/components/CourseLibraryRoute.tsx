/**
 * Course Library entry point.
 *
 * Members browse the catalog on the standalone page; training officers are sent
 * into the admin hub's Course Library tab so they get the training-admin
 * header/nav in context (rather than a bare standalone page).
 *
 * Lives here rather than in routes.tsx so that file exports only its route
 * factory — mixing a component into it breaks Fast Refresh for the module.
 */

import React from 'react';
import { Navigate } from 'react-router';
import { useAuthStore } from '../../../stores/authStore';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';

const CourseLibraryPage = lazyWithRetry(() => import('../../../pages/CourseLibraryPage'));

export const CourseLibraryRoute: React.FC = () => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  if (checkPermission('training.manage')) {
    return <Navigate to="/training/admin?page=setup&tab=courses" replace />;
  }
  return <CourseLibraryPage />;
};

export default CourseLibraryRoute;
