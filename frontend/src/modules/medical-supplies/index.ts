/**
 * Medical Supplies module — EMS stock, kept separate from gear and uniforms
 * so a department can run the two under different officers.
 */

export { getMedicalSuppliesRoutes, MEDICAL_VIEW_PERMISSIONS } from './routes';
export { default as MedicalSuppliesPage } from './pages/MedicalSuppliesPage';
export { default as MedicalCategoriesPage } from './pages/MedicalCategoriesPage';
export { MedicalItemFormModal } from './components/MedicalItemFormModal';
export { ReceiveDeliveryModal } from './components/ReceiveDeliveryModal';
export * from './types';
