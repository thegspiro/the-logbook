/**
 * Print CR80 member ID cards for the members selected on the roster.
 *
 * Reached from the Members page bulk bar as /members/print-id-cards?ids=…. The
 * PDF is generated server-side, one card side per page at exactly 3.375 x
 * 2.125 in, so it prints through any ID card printer's ordinary driver —
 * Zebra, Fargo, Evolis, Magicard, Datacard — with no plug-in or printer
 * language involved. The layout is the department's: it is loaded from, and
 * can be saved back to, the department default, so the next officer prints
 * the same card.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, CreditCard, Download, Loader2, Save, TestTube2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { labelService, Symbology } from '../services/labelService';
import { memberIdCardService } from '../services/memberIdCardService';
import type { IdCardLayout } from '../services/memberIdCardService';
import { IdCardOrientation, IdCardSides } from '../constants/enums';
import { getErrorMessage } from '../utils/errorHandling';
import { getTodayLocalDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';

const DEFAULT_LAYOUT: IdCardLayout = {
  orientation: IdCardOrientation.LANDSCAPE,
  sides: IdCardSides.FRONT,
  symbology: Symbology.CODE128,
};

interface Choice<T extends string> {
  value: T;
  label: string;
  hint: string;
}

const ORIENTATION_CHOICES: Choice<IdCardOrientation>[] = [
  { value: IdCardOrientation.LANDSCAPE, label: 'Landscape', hint: 'Horizontal card' },
  { value: IdCardOrientation.PORTRAIT, label: 'Portrait', hint: 'Vertical card, for clip and lanyard holders' },
];

const SIDES_CHOICES: Choice<IdCardSides>[] = [
  { value: IdCardSides.FRONT, label: 'Front only', hint: 'Everything on one side; any card printer' },
  {
    value: IdCardSides.BOTH,
    label: 'Front and back',
    hint: 'Code and return address on the back; duplex printer, or flip by hand',
  },
];

const SYMBOLOGY_CHOICES: Choice<Symbology>[] = [
  { value: Symbology.CODE128, label: 'Barcode', hint: 'Reads with USB and handheld barcode scanners' },
  { value: Symbology.QR, label: 'QR code', hint: 'Reads with a phone or tablet camera' },
];

const sameLayout = (a: IdCardLayout | null, b: IdCardLayout) =>
  a !== null && a.orientation === b.orientation && a.sides === b.sides && a.symbology === b.symbology;

interface ChoiceGroupProps<T extends string> {
  name: string;
  legend: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}

function ChoiceGroup<T extends string>({ name, legend, choices, value, onChange }: ChoiceGroupProps<T>) {
  return (
    <fieldset className="space-y-2">
      <legend className="form-label">{legend}</legend>
      {choices.map((choice) => (
        <label key={choice.value} className="text-theme-text-secondary flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
            className="mt-0.5"
          />
          <span>
            <span className="text-theme-text-primary">{choice.label}</span>
            <span className="text-theme-text-muted block text-xs">{choice.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const MemberIdCardPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const tz = useTimezone();
  const ids = useMemo(() => (searchParams.get('ids') ?? '').split(',').filter(Boolean), [searchParams]);

  const [names, setNames] = useState<string[]>([]);
  const [layout, setLayout] = useState<IdCardLayout>(DEFAULT_LAYOUT);
  const [savedLayout, setSavedLayout] = useState<IdCardLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<'all' | 'test' | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (ids.length === 0) {
      setError('Nothing selected to print. Go back to Members and select the members who need ID cards.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const [{ items }, departmentLayout] = await Promise.all([
        labelService.preview('membership', ids),
        memberIdCardService.getLayout(),
      ]);
      setNames(items.map((item) => item.name));
      setLayout(departmentLayout);
      setSavedLayout(departmentLayout);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the members to print. Go back and try again.'));
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (testOnly: boolean) => {
    const selection = testOnly ? ids.slice(0, 1) : ids;
    setGenerating(testOnly ? 'test' : 'all');
    try {
      const blob = await memberIdCardService.generatePdf(selection, layout);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = testOnly ? 'test-id-card.pdf' : `member-id-cards-${getTodayLocalDate(tz)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success(testOnly ? 'Test card downloaded' : 'ID card PDF downloaded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not create the ID card PDF. Try again.'));
    } finally {
      setGenerating(null);
    }
  };

  const saveDefault = async () => {
    setSaving(true);
    try {
      const saved = await memberIdCardService.saveLayout(layout);
      setSavedLayout(saved);
      toast.success('Saved as the department’s ID card layout');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the layout. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<IdCardLayout>) => setLayout((current) => ({ ...current, ...patch }));
  const isDepartmentLayout = sameLayout(savedLayout, layout);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link
        to="/members"
        className="mb-4 inline-flex items-center gap-1 text-sm text-blue-700 hover:text-blue-800 dark:text-blue-400"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Members
      </Link>

      <h1 className="text-theme-text-primary mb-1 flex items-center gap-2 text-2xl font-bold">
        <CreditCard className="h-6 w-6" />
        Print ID Cards
      </h1>
      <p className="text-theme-text-secondary mb-6 text-sm">
        Standard CR80 cards (3.375 × 2.125 in) for any ID card printer — Zebra, Fargo, Evolis, Magicard, Datacard and
        others.
      </p>

      {loading ? (
        <div className="text-theme-text-secondary flex items-center gap-2" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading members…
        </div>
      ) : error ? (
        <div className="alert-danger" role="alert">
          {error}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="card space-y-5 p-4 md:col-span-2">
            <div className="grid gap-5 sm:grid-cols-3">
              <ChoiceGroup
                name="orientation"
                legend="Orientation"
                choices={ORIENTATION_CHOICES}
                value={layout.orientation}
                onChange={(orientation) => update({ orientation })}
              />
              <ChoiceGroup
                name="sides"
                legend="Sides"
                choices={SIDES_CHOICES}
                value={layout.sides}
                onChange={(sides) => update({ sides })}
              />
              <ChoiceGroup
                name="symbology"
                legend="Code"
                choices={SYMBOLOGY_CHOICES}
                value={layout.symbology}
                onChange={(symbology) => update({ symbology })}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void download(false)}
                disabled={generating !== null}
                className="btn-primary inline-flex items-center gap-2"
              >
                {generating === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download {names.length} card{names.length === 1 ? '' : 's'} (PDF)
              </button>
              <button
                type="button"
                onClick={() => void download(true)}
                disabled={generating !== null}
                className="btn-secondary inline-flex items-center gap-2"
              >
                {generating === 'test' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TestTube2 className="h-4 w-4" />
                )}
                Test card
              </button>
              {isDepartmentLayout ? (
                <span className="text-theme-text-muted text-xs">Department layout</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void saveDefault()}
                  disabled={saving}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save as department layout
                </button>
              )}
            </div>

            <div className="alert-info text-sm">
              <p className="font-medium">Printing the PDF</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>Open the PDF and print it to your ID card printer.</li>
                <li>Choose the CR80 / ID-1 card size if the driver asks.</li>
                <li>Print at 100% or “Actual size” — not “Fit to page”, which shrinks the barcode.</li>
                {layout.sides === IdCardSides.BOTH && (
                  <li>Turn on two-sided printing in the printer’s options, or print and flip the cards by hand.</li>
                )}
              </ol>
              <p className="mt-2">Print one test card first to check the alignment.</p>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="text-theme-text-primary mb-2 text-sm font-semibold">
              {names.length} member{names.length === 1 ? '' : 's'}
            </h2>
            {names.length < ids.length && (
              <p className="text-theme-text-muted mb-2 text-xs">
                {ids.length - names.length} selected record{ids.length - names.length === 1 ? ' was' : 's were'} not
                found and will be skipped.
              </p>
            )}
            <ul className="text-theme-text-secondary max-h-96 space-y-1 overflow-y-auto text-sm">
              {names.map((name, i) => (
                <li key={`${name}-${i}`}>{name}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemberIdCardPrintPage;
