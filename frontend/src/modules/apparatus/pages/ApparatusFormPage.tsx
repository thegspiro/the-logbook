/**
 * Apparatus Form Page
 *
 * Form for creating or editing apparatus.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Truck, Save, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useRanks } from '@/hooks/useRanks';
import { positionLabel } from '@/modules/scheduling/utils/positionLabels';
import { getPositionOptions } from '@/modules/scheduling/components/shiftTemplateTypes';
import { ensureShiftSettingsLoaded } from '@/modules/scheduling/services/shiftSettingsApi';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { ErrorSummary } from '@/components/ux/ErrorSummary';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import {
  placeApiError,
  useFieldErrors,
  type FieldErrors,
  type FieldSpec,
  type FieldSpecs,
} from '@/hooks/useFieldErrors';
import { firstRefused, saveExceptRefused } from '@/utils/saveExceptRefused';
import { useApparatusStore } from '../store/apparatusStore';
import { apparatusService, evocLevelService } from '../services/api';
import { useApparatusNfpaSettings } from '../hooks/useApparatusNfpaSettings';
import { FUEL_TYPE_LABELS } from '../types';
import type { ApparatusCreate, ApparatusUpdate, EvocLevel, FuelType } from '../types';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';

/** Columns the server stores as NOT NULL; an emptied one is refused by
 * validation or keeps its value, never sent as null. */
const REQUIRED_ON_UPDATE: ReadonlySet<keyof ApparatusUpdate> = new Set<keyof ApparatusUpdate>([
  'unitNumber',
  'apparatusTypeId',
  'statusId',
  'minStaffing',
]);

const CREW_POSITION_CODES = [
  'officer',
  'driver',
  'firefighter',
  'ems',
  'captain',
  'lieutenant',
  'probationary',
  'volunteer',
  'other',
] as const;

/** The boxes on this form a check or a refusal can point at, in page order. */
type ApparatusFormField =
  | 'unitNumber'
  | 'name'
  | 'apparatusTypeId'
  | 'statusId'
  | 'statusReason'
  | 'vin'
  | 'radioId'
  | 'year'
  | 'make'
  | 'model'
  | 'bodyManufacturer'
  | 'licensePlate'
  | 'licenseState'
  | 'color'
  | 'assetTag'
  | 'minStaffing'
  | 'requiredEvocLevelId'
  | 'seatingCapacity'
  | 'crewPositions'
  | 'gvwr'
  | 'fuelType'
  | 'fuelCapacityGallons'
  | 'pumpCapacityGpm'
  | 'tankCapacityGallons'
  | 'foamCapacityGallons'
  | 'ladderLengthFeet'
  | 'currentMileage'
  | 'currentHours'
  | 'purchaseDate'
  | 'purchasePrice'
  | 'purchaseVendor'
  | 'inServiceDate'
  | 'financingCompany'
  | 'monthlyPayment'
  | 'financingEndDate'
  | 'registrationExpiration'
  | 'inspectionExpiration'
  | 'insuranceExpiration'
  | 'warrantyExpiration'
  | 'description'
  | 'notes';

const FIELD_LABELS: Record<ApparatusFormField, string> = {
  unitNumber: 'Unit Number',
  name: 'Name/Nickname',
  apparatusTypeId: 'Apparatus Type',
  statusId: 'Status',
  statusReason: 'Reason',
  vin: 'VIN',
  radioId: 'Radio ID',
  year: 'Year',
  make: 'Make',
  model: 'Model',
  bodyManufacturer: 'Body Manufacturer',
  licensePlate: 'License Plate',
  licenseState: 'License State',
  color: 'Color',
  assetTag: 'Asset Tag',
  minStaffing: 'Minimum Staffing',
  requiredEvocLevelId: 'Required EVOC Level',
  seatingCapacity: 'Seating Capacity',
  crewPositions: 'Crew Positions / Seats',
  gvwr: 'GVWR (lbs)',
  fuelType: 'Fuel Type',
  fuelCapacityGallons: 'Fuel Capacity (gal)',
  pumpCapacityGpm: 'Pump Capacity (GPM)',
  tankCapacityGallons: 'Water Tank (gal)',
  foamCapacityGallons: 'Foam Tank (gal)',
  ladderLengthFeet: 'Ladder Length (ft)',
  currentMileage: 'Current Mileage',
  currentHours: 'Current Hours',
  purchaseDate: 'Purchase Date',
  purchasePrice: 'Purchase Price',
  purchaseVendor: 'Vendor',
  inServiceDate: 'In Service Date',
  financingCompany: 'Financing Company',
  monthlyPayment: 'Monthly Payment',
  financingEndDate: 'Financing End Date',
  registrationExpiration: 'Registration Expiration',
  inspectionExpiration: 'Inspection Expiration',
  insuranceExpiration: 'Insurance Expiration',
  warrantyExpiration: 'Warranty Expiration',
  description: 'Description',
  notes: 'Additional Notes',
};

const snakeCase = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// The apparatus API is camelCase (alias_generator=to_camel), so a refusal
// names the field as the form sends it; the snake_case attribute is listed in
// case one reports that instead. Crew seats are focused through Add Seat, the
// one control the seat list always has.
const FIELD_ORDER = Object.keys(FIELD_LABELS) as ApparatusFormField[];

const APPARATUS_FORM_FIELDS: FieldSpecs<ApparatusFormField> = (() => {
  const specs = {} as Record<ApparatusFormField, FieldSpec>;
  for (const name of FIELD_ORDER) {
    specs[name] = {
      id: name === 'crewPositions' ? 'apparatus-crewPositions-add' : `apparatus-${name}`,
      label: FIELD_LABELS[name],
      apiKeys: [snakeCase(name)],
    };
  }
  return specs;
})();

// Mirrors ApparatusBase / ApparatusUpdate (forms review F-2). License State
// keeps the two-letter box it has always had, inside the server's 50.
const TEXT_LIMITS: Partial<Record<ApparatusFormField, number>> = {
  unitNumber: 50,
  name: 200,
  vin: 17,
  licensePlate: 20,
  licenseState: 2,
  radioId: 50,
  assetTag: 50,
  make: 100,
  model: 100,
  bodyManufacturer: 100,
  color: 50,
  purchaseVendor: 200,
  financingCompany: 200,
};

type NumberRule = { min: number; max?: number; whole: boolean };

// The bounds ApparatusBase enforces on each number, said on the field before
// anything is sent rather than coming back as a refusal.
const NUMBER_RULES: Partial<Record<ApparatusFormField, NumberRule>> = {
  year: { min: 1900, max: 2100, whole: true },
  minStaffing: { min: 1, max: 50, whole: true },
  seatingCapacity: { min: 1, whole: true },
  gvwr: { min: 0, whole: true },
  fuelCapacityGallons: { min: 0, whole: false },
  pumpCapacityGpm: { min: 0, whole: true },
  tankCapacityGallons: { min: 0, whole: true },
  foamCapacityGallons: { min: 0, whole: true },
  ladderLengthFeet: { min: 0, whole: true },
  currentMileage: { min: 0, whole: true },
  currentHours: { min: 0, whole: false },
  purchasePrice: { min: 0, whole: false },
  monthlyPayment: { min: 0, whole: false },
};

function numberProblem(value: unknown, rule: NumberRule): string | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  const ok =
    Number.isFinite(n) &&
    (!rule.whole || Number.isInteger(n)) &&
    n >= rule.min &&
    (rule.max === undefined || n <= rule.max);
  if (ok) return null;
  const kind = rule.whole ? 'a whole number' : 'a number';
  return rule.max !== undefined
    ? `Enter ${kind} from ${rule.min} to ${rule.max}.`
    : `Enter ${kind}, ${rule.min} or more.`;
}

/**
 * What the form can tell before anything is sent. The required messages keep
 * the wording this form has always shown.
 */
function checkApparatus(
  form: ApparatusCreate,
  selectedStatus: { name: string; requiresReason: boolean } | undefined
): FieldErrors<ApparatusFormField> {
  const problems: FieldErrors<ApparatusFormField> = {};
  if (!form.unitNumber.trim()) problems.unitNumber = 'Unit number is required';
  if (!form.apparatusTypeId) problems.apparatusTypeId = 'Apparatus type is required';
  if (!form.statusId) problems.statusId = 'Status is required';
  else if (selectedStatus?.requiresReason && !form.statusReason?.trim())
    problems.statusReason = `Give a reason for ${selectedStatus.name}`;
  for (const name of FIELD_ORDER) {
    const rule = NUMBER_RULES[name];
    const problem = rule ? numberProblem(form[name], rule) : null;
    if (problem) problems[name] = problem;
  }
  return problems;
}

const LABEL_CLASS = 'text-theme-text-secondary mb-1 block text-sm';

/** Put one box back to its stored value, for a field the save left out. */
function restoreField<K extends keyof ApparatusCreate>(target: ApparatusCreate, source: ApparatusCreate, key: K) {
  target[key] = source[key];
}

export const ApparatusFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { enabled: nfpaEnabled } = useApparatusNfpaSettings();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  // Ranks only append eligibility labels to options that are already known, so
  // the seat pickers stay usable while the fetch is in flight.
  const { ranks } = useRanks();
  // Department-configured custom scheduling positions (same source the shift
  // template builder uses). getPositionOptions reads a synchronous cache and
  // kicks a background load; re-read once that load lands so custom positions
  // appear without a remount.
  const [schedulingPositionOptions, setSchedulingPositionOptions] = useState(() => getPositionOptions());
  useEffect(() => {
    let cancelled = false;
    void ensureShiftSettingsLoaded().then(() => {
      if (!cancelled) setSchedulingPositionOptions(getPositionOptions());
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const crewPositionOptions = [
    ...CREW_POSITION_CODES.map((code) => ({ code, label: positionLabel(code) })),
    ...schedulingPositionOptions
      .filter((option) => !CREW_POSITION_CODES.includes(option.value as (typeof CREW_POSITION_CODES)[number]))
      .map((option) => ({ code: option.value, label: option.label })),
  ].map((option) => ({
    ...option,
    eligibleRanks: ranks
      .filter((rank) => rank.eligible_positions?.includes(option.code))
      .map((rank) => rank.display_name),
  }));

  const {
    currentApparatus,
    types,
    statuses,
    isLoading: storeLoading,
    error: storeError,
    fetchApparatus,
    fetchTypes,
    fetchStatuses,
  } = useApparatusStore();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const fieldErrors = useFieldErrors(APPARATUS_FORM_FIELDS);
  const errors = fieldErrors.errors;
  const [summaryFocus, setSummaryFocus] = useState(0);
  const [savedExcept, setSavedExcept] = useState<string | null>(null);
  const [evocLevels, setEvocLevels] = useState<EvocLevel[]>([]);

  // Form state
  const clearedNumbers = useRef(new Set<string>());
  const emptyForm: ApparatusCreate = {
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
    minStaffing: 1,
    crewPositions: [],
    requiredEvocLevelId: '',
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
  };
  const [formData, setFormData] = useState<ApparatusCreate>(emptyForm);
  // What the boxes held when the form opened (or last saved), so leaving with
  // typed changes asks first (forms review F-6).
  const [baseline, setBaseline] = useState<ApparatusCreate>(emptyForm);

  useEffect(() => {
    // Check authentication via session flag (tokens are in httpOnly cookies)
    if (!localStorage.getItem('has_session')) {
      void navigate('/login');
      return;
    }

    void fetchTypes();
    void fetchStatuses();
    void evocLevelService
      .getLevels()
      .then(setEvocLevels)
      .catch(() => {
        /* optional */
      });

    if (isEditing && id) {
      void fetchApparatus(id);
    }
  }, [navigate, isEditing, id, fetchApparatus, fetchTypes, fetchStatuses]);

  // The store keeps the last apparatus opened, so it is this record only once
  // the ids agree. Filling the form from another one and saving would write it
  // onto the apparatus in the URL (AP2-9).
  const editedApparatus = isEditing && currentApparatus?.id === id ? currentApparatus : null;

  // Populate form when editing
  useEffect(() => {
    if (editedApparatus) {
      const currentApparatus = editedApparatus;
      const loaded: ApparatusCreate = {
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
        minStaffing: currentApparatus.minStaffing ?? 1,
        crewPositions: currentApparatus.crewPositions ?? [],
        requiredEvocLevelId: currentApparatus.requiredEvocLevelId || '',
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
      };
      setFormData(loaded);
      setBaseline(loaded);
    }
  }, [editedApparatus]);

  const isDirty = JSON.stringify(formData) !== JSON.stringify(baseline);
  useUnsavedChanges({ hasChanges: isDirty && !isSubmitting });
  // Cancel leaves the page, which throws away what was typed into it.
  const handleCancel = useDiscardGuard({
    isDirty,
    onClose: () => {
      void navigate('/apparatus');
    },
  });

  const clearFieldError = (name: string) => {
    if (name in APPARATUS_FORM_FIELDS) fieldErrors.setError(name as ApparatusFormField, null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;

    let processedValue: string | number | boolean | undefined = value;

    if (type === 'checkbox') {
      processedValue = (e.target as HTMLInputElement).checked;
    } else if (type === 'number') {
      processedValue = value === '' ? undefined : parseFloat(value);
      // A cleared number is stored as undefined, which looks the same as a
      // value that was never set; remember it so an edit can send the clear.
      if (value === '') clearedNumbers.current.add(name);
      else clearedNumbers.current.delete(name);
    }

    setFormData((prev) => ({
      ...prev,
      [name]: processedValue,
      // A reason belongs to the status it was given for: kept across a change
      // it would label a rig back In Service with why it was taken out.
      ...(name === 'statusId' && processedValue !== prev.statusId ? { statusReason: '' } : {}),
    }));

    clearFieldError(name);
    if (name === 'statusId') clearFieldError('statusReason');
  };

  const addCrewPosition = () => {
    setFormData((prev) => ({ ...prev, crewPositions: [...(prev.crewPositions ?? []), ''] }));
    clearFieldError('crewPositions');
  };

  const updateCrewPosition = (index: number, rankCode: string) => {
    setFormData((prev) => ({
      ...prev,
      crewPositions: (prev.crewPositions ?? []).map((position, positionIndex) =>
        positionIndex === index ? rankCode : position
      ),
    }));
    clearFieldError('crewPositions');
  };

  const removeCrewPosition = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      crewPositions: (prev.crewPositions ?? []).filter((_, positionIndex) => positionIndex !== index),
    }));
    clearFieldError('crewPositions');
  };

  const selectedStatus = statuses.find((status) => status.id === formData.statusId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavedExcept(null);

    const problems = checkApparatus(formData, selectedStatus);
    fieldErrors.setFormError(null);
    fieldErrors.setErrors(problems);

    // A new vehicle is created only once every flagged field is fixed. An edit
    // follows the single-save rule (owner, 2026-11-05): the flagged fields are
    // left out and keep their stored values, and the rest is written.
    if (!isEditing && Object.keys(problems).length > 0) {
      setSummaryFocus((n) => n + 1);
      return;
    }

    setIsSubmitting(true);

    try {
      // Clean up empty strings to undefined
      const cleanedData: ApparatusCreate | ApparatusUpdate = {
        ...formData,
        crewPositions: (formData.crewPositions ?? []).filter(Boolean),
      };
      Object.keys(cleanedData).forEach((key) => {
        const k = key as keyof typeof cleanedData;
        if (cleanedData[k] === '') {
          (cleanedData as Record<string, unknown>)[k] = undefined;
        }
      });

      if (isEditing && id) {
        // The server applies an update with exclude_unset, so an omitted key
        // means "leave it": an emptied field has to go as an explicit null or
        // the old value survives behind the success toast (CLAUDE.md pitfall 1).
        // Required columns stay omitted, as before.
        const update: ApparatusUpdate = { ...cleanedData };
        (Object.keys(formData) as Array<keyof ApparatusUpdate>).forEach((key) => {
          if (REQUIRED_ON_UPDATE.has(key)) return;
          if (formData[key] === '' || clearedNumbers.current.has(key)) {
            update[key] = null;
          }
        });
        const { refused } = await saveExceptRefused<ApparatusFormField, unknown>({
          payload: Object.fromEntries(Object.entries(update)),
          refused: problems,
          // A status that needs a reason is only ever saved with one: a refused
          // reason holds the status change back with it, so the rig is not
          // marked Out of Service with no record of why.
          keysFor: (field) => (field === 'statusReason' ? ['statusReason', 'statusId'] : [field]),
          send: (body) => apparatusService.updateApparatus(id, body),
          place: (err) => placeApiError(APPARATUS_FORM_FIELDS, err),
        });
        const first = firstRefused(FIELD_ORDER, refused);
        if (first) {
          fieldErrors.setErrors(refused);
          // The refused boxes still differ from what is stored; everything
          // else now matches it.
          setBaseline((prev) => {
            const next: ApparatusCreate = { ...formData };
            for (const field of Object.keys(refused) as ApparatusFormField[]) {
              restoreField(next, prev, field);
              if (field === 'statusReason') restoreField(next, prev, 'statusId');
            }
            return next;
          });
          clearedNumbers.current = new Set([...clearedNumbers.current].filter((key) => key in refused));
          setSavedExcept(`Apparatus saved, except ${FIELD_LABELS[first].toLowerCase()}. Fix it and save again.`);
          setSummaryFocus((n) => n + 1);
          return;
        }
        toast.success('Apparatus updated');
      } else {
        await apparatusService.createApparatus(cleanedData as ApparatusCreate);
        toast.success('Apparatus added');
      }

      setBaseline(formData);
      void navigate('/apparatus');
    } catch (err: unknown) {
      // Nothing was saved. A refusal lands on the field it names; anything no
      // field answers for is said at the top of the form, by the summary.
      fieldErrors.setFromApiError(err, 'Failed to save apparatus');
      setSummaryFocus((n) => n + 1);
    } finally {
      setIsSubmitting(false);
    }
  };

  const fuelTypes: FuelType[] = ['gasoline', 'diesel', 'electric', 'hybrid', 'propane', 'cng', 'other'];

  const fieldValue = (name: ApparatusFormField): string => {
    const value: unknown = formData[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  };

  /** A text box through the shared field, with its counter where the server has a limit. */
  const textField = (
    name: ApparatusFormField,
    options: {
      required?: boolean;
      placeholder?: string;
      literal?: boolean;
      className?: string;
    } = {}
  ) => {
    const value = fieldValue(name);
    const limit = TEXT_LIMITS[name];
    return (
      <FormField
        id={APPARATUS_FORM_FIELDS[name].id}
        label={FIELD_LABELS[name]}
        labelClassName={LABEL_CLASS}
        required={options.required}
        error={errors[name]}
        {...(limit !== undefined ? { maxLength: limit, count: value.length } : {})}
      >
        {(props) => (
          <input
            {...props}
            type="text"
            name={name}
            value={value}
            onChange={handleChange}
            className={`form-input w-full min-w-0 ${options.className ?? ''}`}
            {...(options.placeholder ? { placeholder: options.placeholder } : {})}
            {...(options.literal ? { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } : {})}
          />
        )}
      </FormField>
    );
  };

  /** A number box through the shared field, with the bound the server enforces. */
  const numberField = (
    name: ApparatusFormField,
    options: { required?: boolean; placeholder?: string; step?: string; hint?: string; fallback?: number } = {}
  ) => {
    const rule = NUMBER_RULES[name];
    const raw: unknown = formData[name];
    const value = typeof raw === 'number' ? raw : (options.fallback ?? '');
    return (
      <FormField
        id={APPARATUS_FORM_FIELDS[name].id}
        label={FIELD_LABELS[name]}
        labelClassName={LABEL_CLASS}
        required={options.required}
        error={errors[name]}
        hint={options.hint}
      >
        {(props) => (
          <input
            {...props}
            type="number"
            name={name}
            value={value}
            onChange={handleChange}
            className="form-input w-full min-w-0"
            {...(rule ? { min: rule.min } : {})}
            {...(rule?.max !== undefined ? { max: rule.max } : {})}
            {...(options.step ? { step: options.step } : {})}
            {...(options.placeholder ? { placeholder: options.placeholder } : {})}
          />
        )}
      </FormField>
    );
  };

  /** A date box through the shared field, so a refused date lands on it. */
  const dateField = (name: ApparatusFormField) => (
    <FormField
      id={APPARATUS_FORM_FIELDS[name].id}
      label={FIELD_LABELS[name]}
      labelClassName={LABEL_CLASS}
      error={errors[name]}
    >
      {(props) => (
        <input
          {...props}
          type="date"
          name={name}
          value={fieldValue(name)}
          onChange={handleChange}
          className="form-input w-full min-w-0"
        />
      )}
    </FormField>
  );

  /** A textarea through the shared field. */
  const textAreaField = (name: ApparatusFormField, placeholder: string) => (
    <FormField
      id={APPARATUS_FORM_FIELDS[name].id}
      label={FIELD_LABELS[name]}
      labelClassName={LABEL_CLASS}
      error={errors[name]}
    >
      {(props) => (
        <textarea
          {...props}
          name={name}
          value={fieldValue(name)}
          onChange={handleChange}
          rows={3}
          className="form-input w-full min-w-0"
          placeholder={placeholder}
        />
      )}
    </FormField>
  );

  if (isEditing && (storeLoading || (!editedApparatus && !storeError))) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="border-theme-text-primary mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2"></div>
          <p className="text-theme-text-secondary">Loading apparatus...</p>
        </div>
      </div>
    );
  }

  // An edit form with nothing loaded into it would save blanks as nulls.
  if (isEditing && !editedApparatus) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Truck className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
          <h2 className="text-theme-text-primary mb-2 text-xl font-bold">Apparatus Not Found</h2>
          <p className="text-theme-text-muted mb-6">
            This apparatus couldn&#39;t be loaded. It may have been deleted, or the link may be wrong.
          </p>
          <button type="button" onClick={() => void navigate('/apparatus')} className="btn-primary px-6 py-3">
            Back to Apparatus
          </button>
        </div>
      </div>
    );
  }

  const editingUnit = editedApparatus?.unitNumber;

  return (
    <div>
      <div data-page-main className="mx-auto max-w-7xl">
        <OperationsPageHeader
          icon={Truck}
          title={isEditing ? (editingUnit ? `Edit ${editingUnit}` : 'Edit Apparatus') : 'Add Apparatus'}
          subtitle={isEditing ? 'Update apparatus details' : 'Add a new piece of apparatus to the fleet'}
          {...(isEditing && id
            ? {
                breadcrumbLabel: 'Edit',
                parentCrumbs: editingUnit ? [{ label: editingUnit, path: `/apparatus/${id}` }] : [],
              }
            : {})}
        />
        <form
          noValidate
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-8"
        >
          {savedExcept && (
            <p role="status" className={`text-sm font-medium ${FIELD_ERROR_CLASS}`}>
              {savedExcept}
            </p>
          )}
          <ErrorSummary
            items={fieldErrors.summary}
            formError={fieldErrors.formError}
            focusKey={summaryFocus}
            title={isEditing ? 'These were not saved' : 'Fix these before adding the apparatus'}
          />
          {!isEditing && (
            <p className="text-theme-text-secondary text-sm">
              Only the fields marked * are needed to start. Everything else can be filled in later with Edit.
            </p>
          )}
          {/* Basic Information */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-6 font-bold">Basic Information</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {textField('unitNumber', { required: true, placeholder: 'E-1', literal: true })}
              {textField('name', { placeholder: 'Old Reliable' })}
              <FormField
                id={APPARATUS_FORM_FIELDS.apparatusTypeId.id}
                label={FIELD_LABELS.apparatusTypeId}
                labelClassName={LABEL_CLASS}
                required
                error={errors.apparatusTypeId}
              >
                {(props) => (
                  <select
                    {...props}
                    name="apparatusTypeId"
                    value={formData.apparatusTypeId}
                    onChange={handleChange}
                    className="form-input w-full min-w-0"
                  >
                    <option value="">Select Type</option>
                    {types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <div>
                <FormField
                  id={APPARATUS_FORM_FIELDS.statusId.id}
                  label={FIELD_LABELS.statusId}
                  labelClassName={LABEL_CLASS}
                  required
                  error={errors.statusId}
                >
                  {(props) => (
                    <select
                      {...props}
                      name="statusId"
                      value={formData.statusId}
                      onChange={handleChange}
                      className="form-input w-full min-w-0"
                    >
                      <option value="">Select Status</option>
                      {statuses
                        .filter((s) => !s.isArchivedStatus)
                        .map((status) => (
                          <option key={status.id} value={status.id}>
                            {status.name}
                          </option>
                        ))}
                    </select>
                  )}
                </FormField>
                {/* Statuses flagged requires_reason (Out of Service, as seeded)
                    are refused without one by POST /apparatus/{id}/status; this
                    form saves through the plain update, which does not check,
                    so the requirement is enforced here. */}
                {formData.statusId && (
                  <FormField
                    id={APPARATUS_FORM_FIELDS.statusReason.id}
                    className="mt-3"
                    label={FIELD_LABELS.statusReason}
                    labelClassName={LABEL_CLASS}
                    required={Boolean(selectedStatus?.requiresReason)}
                    optional={!selectedStatus?.requiresReason}
                    error={errors.statusReason}
                    hint="Shown next to the status on the apparatus page."
                  >
                    {(props) => (
                      <input
                        {...props}
                        name="statusReason"
                        type="text"
                        value={formData.statusReason ?? ''}
                        onChange={handleChange}
                        placeholder="e.g. Pump seal leaking, at the shop"
                        className="form-input w-full min-w-0"
                      />
                    )}
                  </FormField>
                )}
              </div>
              {textField('vin', { placeholder: '1HGCM82633A123456', literal: true, className: 'font-mono' })}
              {textField('radioId', { placeholder: 'E1' })}
            </div>
          </div>

          {/* Vehicle Details */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-6 font-bold">Vehicle Details</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              {numberField('year', { placeholder: '2024' })}
              {textField('make', { placeholder: 'Pierce' })}
              {textField('model', { placeholder: 'Enforcer' })}
              {textField('bodyManufacturer', { placeholder: 'Pierce' })}
              {textField('licensePlate', { literal: true })}
              {textField('licenseState', { placeholder: 'NY', literal: true })}
              {textField('color', { placeholder: 'Red' })}
              {textField('assetTag', { literal: true })}
            </div>
          </div>

          {/* Staffing & Specifications */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-6 font-bold">Staffing & Specifications</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              {numberField('minStaffing', {
                required: true,
                fallback: 1,
                hint: 'Minimum crew members required to staff this apparatus',
              })}
              {evocLevels.length > 0 && (
                <FormField
                  id={APPARATUS_FORM_FIELDS.requiredEvocLevelId.id}
                  label={FIELD_LABELS.requiredEvocLevelId}
                  labelClassName={LABEL_CLASS}
                  error={errors.requiredEvocLevelId}
                  hint="EVOC level required to drive this apparatus"
                >
                  {(props) => (
                    <select
                      {...props}
                      name="requiredEvocLevelId"
                      value={formData.requiredEvocLevelId ?? ''}
                      onChange={handleChange}
                      className="form-input w-full min-w-0"
                    >
                      <option value="">No EVOC requirement</option>
                      {evocLevels.map((level) => (
                        <option key={level.id} value={level.id}>
                          Level {level.levelNumber} — {level.name}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              )}
              {numberField('seatingCapacity')}
              <div className="md:col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-theme-text-secondary block text-sm">{FIELD_LABELS.crewPositions}</span>
                  <button
                    type="button"
                    id={APPARATUS_FORM_FIELDS.crewPositions.id}
                    onClick={addCrewPosition}
                    aria-describedby={errors.crewPositions ? 'apparatus-crewPositions-error' : undefined}
                    className="text-theme-accent-blue hover:bg-theme-accent-blue/10 touch:min-h-11 flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" /> Add Seat
                  </button>
                </div>
                <div className="space-y-2">
                  {(formData.crewPositions ?? []).map((position, index) => {
                    // Legacy = a stored value no current option covers (a
                    // custom position offered above is not legacy — listing it
                    // twice would duplicate the <option> value).
                    const isLegacyPosition =
                      position !== '' && !crewPositionOptions.some((option) => option.code === position);
                    return (
                      <div key={`${index}-${position}`} className="flex items-center gap-2">
                        <span className="text-theme-text-muted w-6 text-right text-xs">{index + 1}.</span>
                        <select
                          aria-label={`Crew seat ${index + 1} position`}
                          value={position}
                          onChange={(event) => updateCrewPosition(index, event.target.value)}
                          className="form-input min-w-0 flex-1"
                        >
                          <option value="">Select a crew position</option>
                          {isLegacyPosition && <option value={position}>{position} (legacy position)</option>}
                          {crewPositionOptions.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.label}
                              {option.eligibleRanks.length > 0 ? ` — ${option.eligibleRanks.join(', ')}` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeCrewPosition(index)}
                          aria-label={`Remove crew seat ${index + 1}`}
                          className="text-theme-text-muted touch:min-h-11 touch:min-w-11 rounded-sm p-1.5 transition-colors hover:text-red-500"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                  {(formData.crewPositions ?? []).length === 0 && (
                    <p className="border-theme-surface-border text-theme-text-muted rounded-lg border border-dashed px-3 py-2 text-sm">
                      No crew seats yet. Select Add Seat to add one.
                    </p>
                  )}
                </div>
                {errors.crewPositions && (
                  <p id="apparatus-crewPositions-error" className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                    {errors.crewPositions}
                  </p>
                )}
                <p className="text-theme-text-muted mt-1 text-xs">
                  List seats in riding order. Each option shows the ranks that can fill it. Repeat a position for each
                  seat of that kind. New shifts on this apparatus start with these seats.
                </p>
              </div>
              {numberField('gvwr')}
              <FormField
                id={APPARATUS_FORM_FIELDS.fuelType.id}
                label={FIELD_LABELS.fuelType}
                labelClassName={LABEL_CLASS}
                error={errors.fuelType}
              >
                {(props) => (
                  <select
                    {...props}
                    name="fuelType"
                    value={formData.fuelType ?? ''}
                    onChange={handleChange}
                    className="form-input w-full min-w-0"
                  >
                    <option value="">Select Fuel Type</option>
                    {fuelTypes.map((ft) => (
                      <option key={ft} value={ft}>
                        {FUEL_TYPE_LABELS[ft]}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              {numberField('fuelCapacityGallons', { step: 'any' })}
              {numberField('pumpCapacityGpm')}
              {numberField('tankCapacityGallons')}
              {numberField('foamCapacityGallons')}
              {numberField('ladderLengthFeet')}
            </div>
          </div>

          {/* Usage Tracking */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-6 font-bold">Usage Tracking</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {numberField('currentMileage')}
              {numberField('currentHours', { step: 'any' })}
            </div>
          </div>

          {/* Purchase Information */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-6 font-bold">Purchase Information</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              {dateField('purchaseDate')}
              {numberField('purchasePrice', { step: '0.01' })}
              {textField('purchaseVendor')}
              {dateField('inServiceDate')}
            </div>

            {/* Financing */}
            <div className="border-theme-surface-border mt-6 border-t pt-6">
              <div className="mb-4 flex items-center">
                <input
                  type="checkbox"
                  id="isFinanced"
                  name="isFinanced"
                  checked={formData.isFinanced}
                  onChange={handleChange}
                  className="form-checkbox"
                />
                <label htmlFor="isFinanced" className="text-theme-text-secondary ml-2">
                  This vehicle is financed
                </label>
              </div>
              {formData.isFinanced && (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  {textField('financingCompany')}
                  {numberField('monthlyPayment', { step: '0.01' })}
                  {dateField('financingEndDate')}
                </div>
              )}
            </div>
          </div>

          {/* Important Dates */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-6 font-bold">Expiration Dates</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
              {dateField('registrationExpiration')}
              {dateField('inspectionExpiration')}
              {dateField('insuranceExpiration')}
              {dateField('warrantyExpiration')}
            </div>
          </div>

          {/* Settings — only for a department that tracks NFPA compliance. The
              stored flag is kept either way, so turning the department switch
              back on restores each vehicle's choice. */}
          {nfpaEnabled && (
            <div className="card p-6">
              <h2 className="text-theme-text-primary mb-6 font-bold">Settings</h2>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="nfpaTrackingEnabled"
                  name="nfpaTrackingEnabled"
                  checked={formData.nfpaTrackingEnabled}
                  onChange={handleChange}
                  aria-describedby="nfpaTrackingEnabled-help"
                  className="form-checkbox"
                />
                <label htmlFor="nfpaTrackingEnabled" className="text-theme-text-secondary ml-2">
                  Enable NFPA compliance tracking
                </label>
              </div>
              {/* Tracking is chosen per vehicle and stored off by default, so the
                  department switch being on does not by itself add the tab. */}
              <p id="nfpaTrackingEnabled-help" className="text-theme-text-muted mt-2 text-sm">
                Adds an NFPA tab to this apparatus for its NFPA 1911 tests, such as the annual pump test. Each apparatus
                is turned on separately; leave it off for vehicles NFPA 1911 does not cover.
              </p>
            </div>
          )}

          {/* Notes */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-6 font-bold">Notes</h2>
            <div className="space-y-4">
              {textAreaField('description', 'Brief description of this apparatus...')}
              {textAreaField('notes', 'Any additional notes...')}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex flex-wrap items-center justify-end gap-4">
            <button
              type="button"
              onClick={handleCancel}
              className="bg-theme-surface-hover hover:bg-theme-surface-hover text-theme-text-primary rounded-lg px-6 py-3 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary flex items-center space-x-2 px-6 py-3 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-white"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="h-5 w-5" />
                  <span>{isEditing ? 'Save Changes' : 'Add Apparatus'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApparatusFormPage;
