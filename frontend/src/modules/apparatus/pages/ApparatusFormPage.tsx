/**
 * Apparatus Form Page
 *
 * Form for creating or editing apparatus.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Truck,
  Save,
  ArrowLeft,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useApparatusStore } from '../store/apparatusStore';
import { apparatusService } from '../services/api';
import type { ApparatusCreate, ApparatusUpdate, FuelType } from '../types';

export const ApparatusFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);

  const {
    currentApparatus,
    types,
    statuses,
    isLoading: storeLoading,
    fetchApparatus,
    fetchTypes,
    fetchStatuses,
  } = useApparatusStore();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form state
  const [formData, setFormData] = useState<ApparatusCreate>({
    unitNumber: '',
    name: '',
    vin: '',
    licensePlate: '',
    licenseState: '',
    radioId: '',
    assetTag: '',
    apparatusTypeId: '',
    statusId: '',
    statusReason: '',
    year: undefined,
    make: '',
    model: '',
    bodyManufacturer: '',
    color: '',
    fuelType: undefined,
    fuelCapacityGallons: undefined,
    seatingCapacity: undefined,
    gvwr: undefined,
    pumpCapacityGpm: undefined,
    tankCapacityGallons: undefined,
    foamCapacityGallons: undefined,
    ladderLengthFeet: undefined,
    primaryStationId: '',
    currentMileage: undefined,
    currentHours: undefined,
    purchaseDate: '',
    purchasePrice: undefined,
    purchaseVendor: '',
    purchaseOrderNumber: '',
    inServiceDate: '',
    isFinanced: false,
    financingCompany: '',
    financingEndDate: '',
    monthlyPayment: undefined,
    originalValue: undefined,
    currentValue: undefined,
    warrantyExpiration: '',
    extendedWarrantyExpiration: '',
    warrantyProvider: '',
    warrantyNotes: '',
    insurancePolicyNumber: '',
    insuranceProvider: '',
    insuranceExpiration: '',
    registrationExpiration: '',
    inspectionExpiration: '',
    nfpaTrackingEnabled: false,
    description: '',
    notes: '',
  });

  useEffect(() => {
    const authToken = localStorage.getItem('access_token');
    if (!authToken) {
      navigate('/login');
      return;
    }

    fetchTypes();
    fetchStatuses();

    if (isEditing && id) {
      fetchApparatus(id);
    }
  }, [navigate, isEditing, id, fetchApparatus, fetchTypes, fetchStatuses]);

  // Populate form when editing
  useEffect(() => {
    if (isEditing && currentApparatus) {
      setFormData({
        unitNumber: currentApparatus.unitNumber,
        name: currentApparatus.name || '',
        vin: currentApparatus.vin || '',
        licensePlate: currentApparatus.licensePlate || '',
        licenseState: currentApparatus.licenseState || '',
        radioId: currentApparatus.radioId || '',
        assetTag: currentApparatus.assetTag || '',
        apparatusTypeId: currentApparatus.apparatusTypeId,
        statusId: currentApparatus.statusId,
        statusReason: currentApparatus.statusReason || '',
        year: currentApparatus.year || undefined,
        make: currentApparatus.make || '',
        model: currentApparatus.model || '',
        bodyManufacturer: currentApparatus.bodyManufacturer || '',
        color: currentApparatus.color || '',
        fuelType: currentApparatus.fuelType || undefined,
        fuelCapacityGallons: currentApparatus.fuelCapacityGallons || undefined,
        seatingCapacity: currentApparatus.seatingCapacity || undefined,
        gvwr: currentApparatus.gvwr || undefined,
        pumpCapacityGpm: currentApparatus.pumpCapacityGpm || undefined,
        tankCapacityGallons: currentApparatus.tankCapacityGallons || undefined,
        foamCapacityGallons: currentApparatus.foamCapacityGallons || undefined,
        ladderLengthFeet: currentApparatus.ladderLengthFeet || undefined,
        primaryStationId: currentApparatus.primaryStationId || '',
        currentMileage: currentApparatus.currentMileage || undefined,
        currentHours: currentApparatus.currentHours || undefined,
        purchaseDate: currentApparatus.purchaseDate?.split('T')[0] || '',
        purchasePrice: currentApparatus.purchasePrice || undefined,
        purchaseVendor: currentApparatus.purchaseVendor || '',
        purchaseOrderNumber: currentApparatus.purchaseOrderNumber || '',
        inServiceDate: currentApparatus.inServiceDate?.split('T')[0] || '',
        isFinanced: currentApparatus.isFinanced,
        financingCompany: currentApparatus.financingCompany || '',
        financingEndDate: currentApparatus.financingEndDate?.split('T')[0] || '',
        monthlyPayment: currentApparatus.monthlyPayment || undefined,
        originalValue: currentApparatus.originalValue || undefined,
        currentValue: currentApparatus.currentValue || undefined,
        warrantyExpiration: currentApparatus.warrantyExpiration?.split('T')[0] || '',
        extendedWarrantyExpiration: currentApparatus.extendedWarrantyExpiration?.split('T')[0] || '',
        warrantyProvider: currentApparatus.warrantyProvider || '',
        warrantyNotes: currentApparatus.warrantyNotes || '',
        insurancePolicyNumber: currentApparatus.insurancePolicyNumber || '',
        insuranceProvider: currentApparatus.insuranceProvider || '',
        insuranceExpiration: currentApparatus.insuranceExpiration?.split('T')[0] || '',
        registrationExpiration: currentApparatus.registrationExpiration?.split('T')[0] || '',
        inspectionExpiration: currentApparatus.inspectionExpiration?.split('T')[0] || '',
        nfpaTrackingEnabled: currentApparatus.nfpaTrackingEnabled,
        description: currentApparatus.description || '',
        notes: currentApparatus.notes || '',
      });
    }
  }, [isEditing, currentApparatus]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;

    let processedValue: string | number | boolean | undefined = value;

    if (type === 'checkbox') {
      processedValue = (e.target as HTMLInputElement).checked;
    } else if (type === 'number') {
      processedValue = value === '' ? undefined : parseFloat(value);
    }

    setFormData((prev) => ({
      ...prev,
      [name]: processedValue,
    }));

    // Clear error when field is modified
    if (errors[name]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.unitNumber.trim()) {
      newErrors.unitNumber = 'Unit number is required';
    }
    if (!formData.apparatusTypeId) {
      newErrors.apparatusTypeId = 'Apparatus type is required';
    }
    if (!formData.statusId) {
      newErrors.statusId = 'Status is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      toast.error('Please fix the errors before submitting');
      return;
    }

    setIsSubmitting(true);

    try {
      // Clean up empty strings to undefined
      const cleanedData: ApparatusCreate | ApparatusUpdate = { ...formData };
      Object.keys(cleanedData).forEach((key) => {
        const k = key as keyof typeof cleanedData;
        if (cleanedData[k] === '') {
          (cleanedData as Record<string, unknown>)[k] = undefined;
        }
      });

      if (isEditing && id) {
        await apparatusService.updateApparatus(id, cleanedData as ApparatusUpdate);
        toast.success('Apparatus updated successfully');
      } else {
        await apparatusService.createApparatus(cleanedData as ApparatusCreate);
        toast.success('Apparatus created successfully');
      }

      navigate('/apparatus');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save apparatus';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const fuelTypes: FuelType[] = ['gasoline', 'diesel', 'electric', 'hybrid', 'propane', 'cng', 'other'];

  if (storeLoading && isEditing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-theme-text-secondary">Loading apparatus...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      {/* Header */}
      <header className="bg-theme-input-bg backdrop-blur-sm border-b border-theme-surface-border px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/apparatus')}
                className="p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface-hover transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center space-x-3">
                <div className="bg-red-600 rounded-lg p-2">
                  <Truck className="w-6 h-6 text-theme-text-primary" />
                </div>
                <div>
                  <h1 className="text-theme-text-primary text-xl font-bold">
                    {isEditing ? 'Edit Apparatus' : 'Add Apparatus'}
                  </h1>
                  <p className="text-theme-text-muted text-sm">
                    {isEditing ? 'Update apparatus details' : 'Add a new piece of apparatus to the fleet'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Information */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
            <h2 className="text-theme-text-primary font-bold mb-6">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">
                  Unit Number <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  name="unitNumber"
                  value={formData.unitNumber}
                  onChange={handleChange}
                  className={`w-full px-4 py-2 bg-theme-input-bg border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    errors.unitNumber ? 'border-red-500' : 'border-theme-input-border'
                  }`}
                  placeholder="E-1"
                />
                {errors.unitNumber && (
                  <p className="text-red-700 dark:text-red-400 text-xs mt-1">{errors.unitNumber}</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Name/Nickname</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Old Reliable"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">
                  Apparatus Type <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <select
                  name="apparatusTypeId"
                  value={formData.apparatusTypeId}
                  onChange={handleChange}
                  className={`w-full px-4 py-2 bg-theme-input-bg border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    errors.apparatusTypeId ? 'border-red-500' : 'border-theme-input-border'
                  }`}
                >
                  <option value="">Select Type</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
                {errors.apparatusTypeId && (
                  <p className="text-red-700 dark:text-red-400 text-xs mt-1">{errors.apparatusTypeId}</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">
                  Status <span className="text-red-700 dark:text-red-400">*</span>
                </label>
                <select
                  name="statusId"
                  value={formData.statusId}
                  onChange={handleChange}
                  className={`w-full px-4 py-2 bg-theme-input-bg border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    errors.statusId ? 'border-red-500' : 'border-theme-input-border'
                  }`}
                >
                  <option value="">Select Status</option>
                  {statuses.filter(s => !s.isArchivedStatus).map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
                {errors.statusId && (
                  <p className="text-red-700 dark:text-red-400 text-xs mt-1">{errors.statusId}</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">VIN</label>
                <input
                  type="text"
                  name="vin"
                  value={formData.vin}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                  placeholder="1HGCM82633A123456"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Radio ID</label>
                <input
                  type="text"
                  name="radioId"
                  value={formData.radioId}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="E1"
                />
              </div>
            </div>
          </div>

          {/* Vehicle Details */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
            <h2 className="text-theme-text-primary font-bold mb-6">Vehicle Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Year</label>
                <input
                  type="number"
                  name="year"
                  value={formData.year ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="2024"
                  min="1900"
                  max="2100"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Make</label>
                <input
                  type="text"
                  name="make"
                  value={formData.make}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Pierce"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Model</label>
                <input
                  type="text"
                  name="model"
                  value={formData.model}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Enforcer"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Body Manufacturer</label>
                <input
                  type="text"
                  name="bodyManufacturer"
                  value={formData.bodyManufacturer}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Pierce"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">License Plate</label>
                <input
                  type="text"
                  name="licensePlate"
                  value={formData.licensePlate}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">License State</label>
                <input
                  type="text"
                  name="licenseState"
                  value={formData.licenseState}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="NY"
                  maxLength={2}
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Color</label>
                <input
                  type="text"
                  name="color"
                  value={formData.color}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Red"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Asset Tag</label>
                <input
                  type="text"
                  name="assetTag"
                  value={formData.assetTag}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>
          </div>

          {/* Specifications */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
            <h2 className="text-theme-text-primary font-bold mb-6">Specifications</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Fuel Type</label>
                <select
                  name="fuelType"
                  value={formData.fuelType ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Select Fuel Type</option>
                  {fuelTypes.map((ft) => (
                    <option key={ft} value={ft}>
                      {ft.charAt(0).toUpperCase() + ft.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Fuel Capacity (gal)</label>
                <input
                  type="number"
                  name="fuelCapacityGallons"
                  value={formData.fuelCapacityGallons ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Seating Capacity</label>
                <input
                  type="number"
                  name="seatingCapacity"
                  value={formData.seatingCapacity ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">GVWR (lbs)</label>
                <input
                  type="number"
                  name="gvwr"
                  value={formData.gvwr ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Pump Capacity (GPM)</label>
                <input
                  type="number"
                  name="pumpCapacityGpm"
                  value={formData.pumpCapacityGpm ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Water Tank (gal)</label>
                <input
                  type="number"
                  name="tankCapacityGallons"
                  value={formData.tankCapacityGallons ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Foam Tank (gal)</label>
                <input
                  type="number"
                  name="foamCapacityGallons"
                  value={formData.foamCapacityGallons ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Ladder Length (ft)</label>
                <input
                  type="number"
                  name="ladderLengthFeet"
                  value={formData.ladderLengthFeet ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>
          </div>

          {/* Usage Tracking */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
            <h2 className="text-theme-text-primary font-bold mb-6">Usage Tracking</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Current Mileage</label>
                <input
                  type="number"
                  name="currentMileage"
                  value={formData.currentMileage ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Current Hours</label>
                <input
                  type="number"
                  name="currentHours"
                  value={formData.currentHours ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>
          </div>

          {/* Purchase Information */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
            <h2 className="text-theme-text-primary font-bold mb-6">Purchase Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Purchase Date</label>
                <input
                  type="date"
                  name="purchaseDate"
                  value={formData.purchaseDate}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Purchase Price</label>
                <input
                  type="number"
                  name="purchasePrice"
                  value={formData.purchasePrice ?? ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  step="0.01"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Vendor</label>
                <input
                  type="text"
                  name="purchaseVendor"
                  value={formData.purchaseVendor}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">In Service Date</label>
                <input
                  type="date"
                  name="inServiceDate"
                  value={formData.inServiceDate}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            {/* Financing */}
            <div className="mt-6 pt-6 border-t border-theme-surface-border">
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="isFinanced"
                  name="isFinanced"
                  checked={formData.isFinanced}
                  onChange={handleChange}
                  className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
                />
                <label htmlFor="isFinanced" className="ml-2 text-theme-text-secondary">
                  This vehicle is financed
                </label>
              </div>
              {formData.isFinanced && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm text-theme-text-secondary mb-1">Financing Company</label>
                    <input
                      type="text"
                      name="financingCompany"
                      value={formData.financingCompany}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-theme-text-secondary mb-1">Monthly Payment</label>
                    <input
                      type="number"
                      name="monthlyPayment"
                      value={formData.monthlyPayment ?? ''}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-theme-text-secondary mb-1">Financing End Date</label>
                    <input
                      type="date"
                      name="financingEndDate"
                      value={formData.financingEndDate}
                      onChange={handleChange}
                      className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Important Dates */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
            <h2 className="text-theme-text-primary font-bold mb-6">Important Dates</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Registration Expiration</label>
                <input
                  type="date"
                  name="registrationExpiration"
                  value={formData.registrationExpiration}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Inspection Expiration</label>
                <input
                  type="date"
                  name="inspectionExpiration"
                  value={formData.inspectionExpiration}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Insurance Expiration</label>
                <input
                  type="date"
                  name="insuranceExpiration"
                  value={formData.insuranceExpiration}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Warranty Expiration</label>
                <input
                  type="date"
                  name="warrantyExpiration"
                  value={formData.warrantyExpiration}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>
          </div>

          {/* Settings */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
            <h2 className="text-theme-text-primary font-bold mb-6">Settings</h2>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="nfpaTrackingEnabled"
                name="nfpaTrackingEnabled"
                checked={formData.nfpaTrackingEnabled}
                onChange={handleChange}
                className="w-4 h-4 rounded border-theme-input-border bg-theme-input-bg text-red-600 focus:ring-red-500"
              />
              <label htmlFor="nfpaTrackingEnabled" className="ml-2 text-theme-text-secondary">
                Enable NFPA compliance tracking
              </label>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-6">
            <h2 className="text-theme-text-primary font-bold mb-6">Notes</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Brief description of this apparatus..."
                />
              </div>
              <div>
                <label className="block text-sm text-theme-text-secondary mb-1">Additional Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Any additional notes..."
                />
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end space-x-4">
            <button
              type="button"
              onClick={() => navigate('/apparatus')}
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-theme-text-primary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center space-x-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  <span>{isEditing ? 'Update Apparatus' : 'Create Apparatus'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};

export default ApparatusFormPage;
