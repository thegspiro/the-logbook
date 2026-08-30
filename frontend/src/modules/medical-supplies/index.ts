/**
 * Medical Supplies module — EMS stock, kept separate from gear and uniforms
 * so a department can run the two under different officers.
 */

export { getMedicalSuppliesRoutes, MEDICAL_VIEW_PERMISSIONS } from './routes';
export { MedicalItemFormModal } from './components/MedicalItemFormModal';
export { ReceiveDeliveryModal } from './components/ReceiveDeliveryModal';
export * from './types';
