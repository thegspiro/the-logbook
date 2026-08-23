/**
 * Organization settings: network label printers.
 *
 * Registering a printer here is what turns on the **Send to Printer** button on
 * every module's label page. The form is inline rather than a modal — the list
 * and the thing being edited stay on screen together, and there is no fixed
 * centred panel to overflow a short viewport (CLAUDE.md pitfall 21).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Printer,
  Star,
  Stethoscope,
  TestTube2,
  Trash2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getErrorMessage } from '../../utils/errorHandling';
import { labelPrinterService } from '../../services/labelService';
import type {
  LabelPrinterConfig,
  LabelPrinterCreatePayload,
  LabelPrinterUpdatePayload,
  PrinterStatus,
  SavedPrinterStatus,
} from '../../services/labelService';
import { CUSTOM_PRESET_ID, LABEL_PRESETS } from '../labels/labelPresets';

// A roll-fed printer has no page to lay an Avery grid on, so the sheet preset
// is not offered here at all.
const THERMAL_PRESETS = LABEL_PRESETS.filter((p) => p.columns === 1);

const DPI_OPTIONS = [
  { value: 203, label: '203 dpi (standard)' },
  { value: 300, label: '300 dpi (high)' },
  { value: 600, label: '600 dpi (industrial)' },
];

interface FormState {
  name: string;
  location: string;
  host: string;
  port: string;
  dpi: string;
  labelFormat: string;
  customWidth: string;
  customHeight: string;
  darkness: string;
  isDefault: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  location: '',
  host: '',
  port: '9100',
  dpi: '203',
  labelFormat: 'zebra_2x1',
  customWidth: '2',
  customHeight: '1',
  darkness: '',
  isDefault: false,
};

const formatLabel = (id: string) => THERMAL_PRESETS.find((p) => p.id === id)?.name ?? id;

/**
 * What the printer said about itself.
 *
 * "Connected" is deliberately not treated as good news: a TCP connection
 * succeeds against a printer that is out of labels and against whatever else
 * happens to hold that address, so a device that answers nothing is called out
 * rather than shown as fine.
 */
const PrinterStatusLine: React.FC<{ status: PrinterStatus }> = ({ status }) => {
  if (!status.responded) {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Connected, but nothing answered — check that this address is the printer.
      </p>
    );
  }
  if (status.errors.length > 0) {
    return (
      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {status.errors.join(', ')}
      </p>
    );
  }
  const details = [status.model, status.reported_dpi ? `${status.reported_dpi} dpi` : null, status.firmware].filter(
    Boolean
  );
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {details.length > 0 ? details.join(' · ') : 'Printer responded'}
      {status.warnings.length > 0 ? ` — ${status.warnings.join(', ')}` : ''}
      {!status.status_available ? ' (no fault reporting on this firmware)' : ''}
    </p>
  );
};

const LabelPrintersSection: React.FC = () => {
  const { confirm } = useConfirm();
  const [printers, setPrinters] = useState<LabelPrinterConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, SavedPrinterStatus>>({});
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<PrinterStatus | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setPrinters(await labelPrinterService.list(true));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load label printers'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setProbeResult(null);
  };

  const startCreate = () => {
    setForm({ ...EMPTY_FORM, isDefault: printers.length === 0 });
    setEditingId(null);
    setProbeResult(null);
    setShowForm(true);
  };

  const startEdit = (printer: LabelPrinterConfig) => {
    setForm({
      name: printer.name,
      location: printer.location ?? '',
      host: printer.host,
      port: String(printer.port),
      dpi: String(printer.dpi),
      labelFormat: printer.label_format,
      customWidth: printer.custom_width != null ? String(printer.custom_width) : '2',
      customHeight: printer.custom_height != null ? String(printer.custom_height) : '1',
      darkness: printer.darkness != null ? String(printer.darkness) : '',
      isDefault: printer.is_default,
    });
    setEditingId(printer.id);
    setProbeResult(null);
    setShowForm(true);
  };

  const isCustom = form.labelFormat === CUSTOM_PRESET_ID;
  const customWidth = parseFloat(form.customWidth);
  const customHeight = parseFloat(form.customHeight);
  const customValid =
    !isCustom ||
    (Number.isFinite(customWidth) &&
      Number.isFinite(customHeight) &&
      customWidth >= 0.5 &&
      customWidth <= 8 &&
      customHeight >= 0.5 &&
      customHeight <= 11);
  const canSave = form.name.trim() !== '' && form.host.trim() !== '' && customValid;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const darkness = form.darkness.trim() === '' ? undefined : Number(form.darkness);
    try {
      if (editingId) {
        // Update path: send every field the form owns, using null (not an
        // omitted key) to clear one — an omitted key means "leave it alone".
        const payload: LabelPrinterUpdatePayload = {
          name: form.name.trim(),
          host: form.host.trim(),
          port: Number(form.port) || 9100,
          dpi: Number(form.dpi) || 203,
          label_format: form.labelFormat,
          location: form.location.trim() || null,
          custom_width: isCustom ? customWidth : null,
          custom_height: isCustom ? customHeight : null,
          darkness: darkness ?? null,
          is_default: form.isDefault,
        };
        await labelPrinterService.update(editingId, payload);
        toast.success('Printer updated');
      } else {
        // Create path: blanks are omitted so an empty string never reaches a
        // validator (CLAUDE.md pitfall 1 — `||`, never `??`).
        const payload: LabelPrinterCreatePayload = {
          name: form.name.trim(),
          host: form.host.trim(),
          port: Number(form.port) || 9100,
          dpi: Number(form.dpi) || 203,
          label_format: form.labelFormat,
          location: form.location.trim() || undefined,
          ...(isCustom ? { custom_width: customWidth, custom_height: customHeight } : {}),
          darkness,
          is_default: form.isDefault,
        };
        await labelPrinterService.create(payload);
        toast.success('Printer added');
      }
      closeForm();
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the printer'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (printer: LabelPrinterConfig) => {
    const ok = await confirm({
      title: 'Remove this printer?',
      message: `${printer.name} will no longer appear as a destination on label print pages. The printer itself is not changed.`,
      confirmLabel: 'Remove printer',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await labelPrinterService.remove(printer.id);
      toast.success('Printer removed');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove the printer'));
    }
  };

  const sendTest = async (printer: LabelPrinterConfig) => {
    setTestingId(printer.id);
    try {
      const result = await labelPrinterService.test(printer.id);
      toast.success(`Test label sent to ${printer.name}`);
      if (result.printer_errors.length > 0) {
        toast.error(`${printer.name}: ${result.printer_errors.join(', ')}`, { duration: 8000 });
      } else if (result.printer_warnings.length > 0) {
        toast(`${printer.name}: ${result.printer_warnings.join(', ')}`, { duration: 6000 });
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not reach the printer'));
    } finally {
      setTestingId(null);
    }
  };

  const checkStatus = async (printer: LabelPrinterConfig) => {
    setCheckingId(printer.id);
    try {
      const status = await labelPrinterService.status(printer.id);
      setStatuses((prev) => ({ ...prev, [printer.id]: status }));
      if (!status.responded) {
        toast.error(`${printer.name} accepted the connection but did not answer — it may not be a ZPL printer`);
      } else if (status.errors.length > 0) {
        toast.error(`${printer.name}: ${status.errors.join(', ')}`, { duration: 8000 });
      } else {
        toast.success(`${printer.name} is ready`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not reach the printer'));
    } finally {
      setCheckingId(null);
    }
  };

  const probe = async () => {
    const host = form.host.trim();
    if (!host) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const result = await labelPrinterService.probe(host, Number(form.port) || 9100);
      setProbeResult(result);
      // The printer knows its own resolution; taking its word for it removes
      // the field most likely to be set wrong, and wrong dpi silently prints
      // the label at the wrong physical size.
      if (result.reported_dpi && String(result.reported_dpi) !== form.dpi) {
        setForm((prev) => ({ ...prev, dpi: String(result.reported_dpi) }));
        toast.success(`Found ${result.model ?? 'a printer'} — set resolution to ${result.reported_dpi} dpi`);
      } else if (result.identified) {
        toast.success(`Found ${result.model ?? 'a printer'}`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not reach that address'));
    } finally {
      setProbing(false);
    }
  };

  const makeDefault = async (printer: LabelPrinterConfig) => {
    try {
      await labelPrinterService.update(printer.id, { is_default: true });
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to set the default printer'));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">Label Printers</h3>
        <p className="text-theme-text-muted mt-1 text-sm">
          Register the department&apos;s network label printers. Once one is here, every label print page gains a{' '}
          <strong>Send to Printer</strong> button that prints without a print dialog — so nothing can rescale a barcode
          and stop it scanning.
        </p>
      </div>

      <div className="border-theme-accent-blue/20 bg-theme-accent-blue-muted flex items-start gap-3 rounded-lg border p-4">
        <Printer className="text-theme-accent-blue mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-theme-text-secondary text-sm">
          Works with Zebra and other ZPL-compatible printers that accept raw printing on port 9100. The printer must be
          reachable from the server on the department network. Use <strong>Send test label</strong> after adding one to
          confirm the connection and label alignment.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
          <span className="text-theme-text-secondary text-sm">Loading printers…</span>
        </div>
      ) : (
        <div className="space-y-3">
          {printers.length === 0 && !showForm ? (
            <p className="text-theme-text-muted border-theme-surface-border rounded-lg border border-dashed p-6 text-center text-sm">
              No label printers yet. Label pages will still offer PDF and browser printing.
            </p>
          ) : null}

          {printers.map((printer) => (
            <div key={printer.id} className="card-secondary flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-theme-text-primary font-medium">{printer.name}</span>
                  {printer.is_default && (
                    <span className="badge bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Default</span>
                  )}
                  {!printer.is_active && (
                    <span className="badge bg-theme-surface-secondary text-theme-text-muted">Disabled</span>
                  )}
                </div>
                <p className="text-theme-text-muted mt-1 text-xs">
                  {printer.host}:{printer.port} · {printer.dpi} dpi · {formatLabel(printer.label_format)}
                  {printer.location ? ` · ${printer.location}` : ''}
                </p>
                {statuses[printer.id] ? (
                  <PrinterStatusLine status={statuses[printer.id] as SavedPrinterStatus} />
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!printer.is_default && (
                  <button
                    onClick={() => {
                      void makeDefault(printer);
                    }}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors"
                  >
                    <Star className="h-3.5 w-3.5" /> Make default
                  </button>
                )}
                <button
                  onClick={() => {
                    void checkStatus(printer);
                  }}
                  disabled={checkingId === printer.id}
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50"
                >
                  {checkingId === printer.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Stethoscope className="h-3.5 w-3.5" />
                  )}
                  Check status
                </button>
                <button
                  onClick={() => {
                    void sendTest(printer);
                  }}
                  disabled={testingId === printer.id}
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50"
                >
                  {testingId === printer.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <TestTube2 className="h-3.5 w-3.5" />
                  )}
                  Send test label
                </button>
                <button
                  onClick={() => startEdit(printer)}
                  aria-label={`Edit ${printer.name}`}
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded-lg border p-1.5 transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    void remove(printer);
                  }}
                  aria-label={`Remove ${printer.name}`}
                  className="rounded-lg border border-red-500/30 p-1.5 text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="card-secondary space-y-4 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-theme-text-primary font-medium">{editingId ? 'Edit printer' : 'Add a printer'}</h4>
            <button
              onClick={closeForm}
              aria-label="Cancel"
              className="text-theme-text-muted hover:text-theme-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="printer-name" className="form-label">
                Name
              </label>
              <input
                id="printer-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Quartermaster Zebra"
                className="form-input w-full"
              />
            </div>
            <div>
              <label htmlFor="printer-location" className="form-label">
                Location <span className="text-theme-text-muted">(optional)</span>
              </label>
              <input
                id="printer-location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Station 1 supply room"
                className="form-input w-full"
              />
            </div>
            <div>
              <label htmlFor="printer-host" className="form-label">
                Hostname or IP address
              </label>
              <input
                id="printer-host"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="192.168.1.50"
                className="form-input w-full"
              />
            </div>
            <div>
              <label htmlFor="printer-port" className="form-label">
                Port
              </label>
              <input
                id="printer-port"
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                className="form-input w-full"
              />
              <p className="text-theme-text-muted mt-1 text-xs">9100 is the standard raw-print port.</p>
              <button
                onClick={() => {
                  void probe();
                }}
                disabled={probing || form.host.trim() === ''}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary mt-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50"
              >
                {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                Test connection
              </button>
              {probeResult ? <PrinterStatusLine status={probeResult} /> : null}
            </div>
            <div>
              <label htmlFor="printer-dpi" className="form-label">
                Resolution
              </label>
              <select
                id="printer-dpi"
                value={form.dpi}
                onChange={(e) => setForm({ ...form, dpi: e.target.value })}
                className="form-input w-full"
              >
                {DPI_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-theme-text-muted mt-1 text-xs">
                Printing at the wrong resolution prints the label at the wrong physical size.
              </p>
            </div>
            <div>
              <label htmlFor="printer-format" className="form-label">
                Label stock loaded
              </label>
              <select
                id="printer-format"
                value={form.labelFormat}
                onChange={(e) => setForm({ ...form, labelFormat: e.target.value })}
                className="form-input w-full"
              >
                {THERMAL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value={CUSTOM_PRESET_ID}>Custom size</option>
              </select>
            </div>
          </div>

          {isCustom && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="printer-cw" className="form-label">
                  Width (in)
                </label>
                <input
                  id="printer-cw"
                  type="number"
                  step="0.05"
                  value={form.customWidth}
                  onChange={(e) => setForm({ ...form, customWidth: e.target.value })}
                  className="form-input w-24"
                />
              </div>
              <div>
                <label htmlFor="printer-ch" className="form-label">
                  Height (in)
                </label>
                <input
                  id="printer-ch"
                  type="number"
                  step="0.05"
                  value={form.customHeight}
                  onChange={(e) => setForm({ ...form, customHeight: e.target.value })}
                  className="form-input w-24"
                />
              </div>
              {!customValid && (
                <p className="pb-2 text-xs text-red-600 dark:text-red-400">
                  Enter 0.5–8&quot; wide and 0.5–11&quot; tall.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label htmlFor="printer-darkness" className="form-label">
                Darkness adjustment <span className="text-theme-text-muted">(optional)</span>
              </label>
              <input
                id="printer-darkness"
                type="number"
                min={-30}
                max={30}
                value={form.darkness}
                onChange={(e) => setForm({ ...form, darkness: e.target.value })}
                placeholder="0"
                className="form-input w-24"
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Leave blank to keep the printer&apos;s own setting. Raise it if bars print faint.
              </p>
            </div>
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                className="form-checkbox"
              />
              <span className="text-theme-text-secondary">Use as the default printer</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void save();
              }}
              disabled={!canSave || saving}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editingId ? 'Save changes' : 'Add printer'}
            </button>
            <button
              onClick={closeForm}
              className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary rounded-lg border px-3 py-2 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={startCreate}
          className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
        >
          <Plus className="h-4 w-4" /> Add a printer
        </button>
      )}
    </div>
  );
};

export default LabelPrintersSection;
