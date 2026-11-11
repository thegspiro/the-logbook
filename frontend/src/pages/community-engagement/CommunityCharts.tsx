import React, { useState } from 'react';
import type { CommunityReachBucket } from '../../services/api';
import { formatNumber } from '../../utils/dateFormatting';
import { bucketLabel, niceMax, type TypeSlice } from './communityEngagement';

/*
 * Series colours from the validated categorical palette, light then dark.
 * Signed-in guests take the first slot because they are the figure the
 * department can prove; estimates take the second. Text is never drawn in a
 * series colour: the orange is under 3:1 on the light surface, so the legend
 * and tooltip carry the meaning in words.
 */
const SIGNED_IN = 'fill-[#2a78d6] dark:fill-[#3987e5]';
const ESTIMATED = 'fill-[#eb6834] dark:fill-[#d95926]';
const SIGNED_IN_BG = 'bg-[#2a78d6] dark:bg-[#3987e5]';
const ESTIMATED_BG = 'bg-[#eb6834] dark:bg-[#d95926]';
const TOTAL_BG = 'bg-[#1baf7a] dark:bg-[#199e70]';

const roundedTop = (x: number, top: number, w: number, h: number): string => {
  const r = Math.min(4, h, w / 2);
  return `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${top + h} Z`;
};

export const ReachLegend: React.FC = () => (
  <div className="text-theme-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs">
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${SIGNED_IN_BG}`} aria-hidden="true" />
      Signed in
    </span>
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${ESTIMATED_BG}`} aria-hidden="true" />
      Estimated from the request
    </span>
  </div>
);

interface ReachChartProps {
  buckets: CommunityReachBucket[];
  /** A phone: label every other column so three-letter months never touch. */
  narrow?: boolean;
}

/** The plot's height in CSS pixels; the drawing's vertical units are pixels too. */
const PLOT_H = 200;
const TOP_PAD = 8;
/** Horizontal drawing units per column. The SVG stretches to its box, so only the ratio matters. */
const COLUMN = 40;
const BAR = 22;

/**
 * People reached per month (or year), signed-in guests with the requesters'
 * estimates stacked above them. Hover or tap a column for its figures; the
 * same figures sit in a disclosure table below, since a pointer-only tooltip
 * is no use to a keyboard or screen-reader user.
 *
 * The axis labels are HTML beside and below the drawing, never SVG text and
 * never on top of it: that keeps them 12px at any width, and axe can measure
 * their contrast, which it declines to do for text over an image.
 */
export const ReachByPeriodChart: React.FC<ReachChartProps> = ({ buckets, narrow = false }) => {
  const [active, setActive] = useState<number | null>(null);
  const count = Math.max(1, buckets.length);
  const width = count * COLUMN;
  const plotH = PLOT_H - TOP_PAD;
  const top = niceMax(Math.max(0, ...buckets.map((b) => b.signed_in + b.estimated)));
  const y = (v: number) => TOP_PAD + plotH - (v / top) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const labelEvery = Math.max(1, Math.ceil(count / (narrow ? 6 : 12)));
  const shown = active != null ? buckets[active] : undefined;
  const axisWidth = `${formatNumber(top).length * 0.62 + 0.25}em`;

  return (
    <figure onMouseLeave={() => setActive(null)}>
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <div
          aria-hidden="true"
          className="text-theme-text-muted relative text-xs tabular-nums"
          style={{ height: PLOT_H, width: axisWidth }}
        >
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: y(t) }}>
              {formatNumber(Math.round(t))}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height: PLOT_H }}>
          <svg
            viewBox={`0 0 ${width} ${PLOT_H}`}
            preserveAspectRatio="none"
            className="block h-full w-full"
            role="img"
            aria-label="People reached over the period: signed-in guests and estimated audiences"
          >
            {ticks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={width}
                y1={y(t)}
                y2={y(t)}
                stroke="currentColor"
                className="text-theme-surface-border"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {buckets.map((b, i) => {
              const x = i * COLUMN + (COLUMN - BAR) / 2;
              const signedTop = y(b.signed_in);
              const signedH = TOP_PAD + plotH - signedTop;
              // A 2px surface gap between the two segments keeps them readable as two.
              const gap = b.signed_in > 0 && b.estimated > 0 ? 2 : 0;
              const estTop = y(b.signed_in + b.estimated);
              const estH = Math.max(0, signedTop - gap - estTop);
              return (
                <g key={b.period} opacity={active != null && active !== i ? 0.55 : 1}>
                  {b.signed_in > 0 &&
                    (b.estimated > 0 ? (
                      <rect x={x} y={signedTop} width={BAR} height={signedH} className={SIGNED_IN} />
                    ) : (
                      <path d={roundedTop(x, signedTop, BAR, signedH)} className={SIGNED_IN} />
                    ))}
                  {b.estimated > 0 && estH > 0 && <path d={roundedTop(x, estTop, BAR, estH)} className={ESTIMATED} />}
                  {/* The whole column is the hover target, not just the bar: a month with ten people is a sliver. */}
                  <rect
                    x={i * COLUMN}
                    y={0}
                    width={COLUMN}
                    height={PLOT_H}
                    fill="transparent"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => setActive(active === i ? null : i)}
                  />
                </g>
              );
            })}
          </svg>
          {shown && active != null && (
            <div
              className="bg-theme-surface-modal border-theme-surface-border pointer-events-none absolute top-0 rounded-md border px-2.5 py-1.5 text-xs shadow-md"
              style={{
                // Centred over the column, but never past either edge of the plot.
                left: `clamp(0px, calc(${((active + 0.5) / count) * 100}% - 7.5rem), calc(100% - 15rem))`,
                width: '15rem',
              }}
              aria-hidden="true"
            >
              <div className="text-theme-text-primary font-semibold">
                {bucketLabel(shown.period, true)} · {formatNumber(shown.signed_in + shown.estimated)} people
              </div>
              <div className="text-theme-text-secondary">
                {shown.events} {shown.events === 1 ? 'event' : 'events'} · {formatNumber(shown.signed_in)} signed in,{' '}
                {formatNumber(shown.estimated)} estimated
              </div>
            </div>
          )}
        </div>
        <div />
        <div aria-hidden="true" className="text-theme-text-muted relative mt-1 h-5 text-xs">
          {buckets.map((b, i) =>
            i % labelEvery === 0 ? (
              <span
                key={b.period}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${((i + 0.5) / count) * 100}%` }}
              >
                {bucketLabel(b.period)}
              </span>
            ) : null
          )}
        </div>
      </div>
      {/* The figures behind the bars, for a keyboard or screen-reader user the
          pointer-only tooltip does not reach, and for anybody who wants the
          numbers rather than the shape. */}
      <details className="mt-2 text-xs">
        <summary className="text-theme-text-secondary touch:min-h-11 inline-flex cursor-pointer items-center">
          Show the figures
        </summary>
        <table className="mt-2 w-full" aria-label="People reached by period">
          <thead className="text-theme-text-muted text-left">
            <tr>
              <th scope="col" className="py-1 pr-2 font-medium">
                Period
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Events
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Signed in
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Estimated
              </th>
            </tr>
          </thead>
          <tbody className="text-theme-text-secondary tabular-nums">
            {buckets.map((b) => (
              <tr key={b.period}>
                <th scope="row" className="py-0.5 pr-2 text-left font-normal">
                  {bucketLabel(b.period, true)}
                </th>
                <td className="py-0.5 pr-2 text-right">{formatNumber(b.events)}</td>
                <td className="py-0.5 pr-2 text-right">{formatNumber(b.signed_in)}</td>
                <td className="py-0.5 text-right">{formatNumber(b.estimated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
};

/**
 * People reached by type of outreach, one bar each. A single series, so one
 * colour — the palette's third slot rather than the blue, which the chart
 * beside this one uses to mean "signed in" and this total is not. It is under
 * 3:1 on the light surface, so every bar carries its value in text. Other is
 * the neutral grey so it never reads as a fourth category.
 */
export const ReachByTypeBars: React.FC<{ slices: TypeSlice[] }> = ({ slices }) => {
  const max = Math.max(1, ...slices.map((s) => s.people_reached));
  return (
    <ul className="space-y-3">
      {slices.map((s) => (
        <li key={s.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-theme-text-primary min-w-0 truncate">{s.label}</span>
            <span className="text-theme-text-secondary shrink-0 tabular-nums">
              <span className="font-medium">{formatNumber(s.people_reached)}</span>
              <span className="text-theme-text-muted ml-1 text-xs">
                · {s.events} {s.events === 1 ? 'event' : 'events'}
              </span>
            </span>
          </div>
          <div className="bg-theme-surface-hover h-2 rounded-full" aria-hidden="true">
            <div
              className={`h-2 rounded-full ${s.other ? 'bg-[#8a8986]' : TOTAL_BG}`}
              style={{ width: `${(s.people_reached / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
};
