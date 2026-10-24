/**
 * A list of member ID card taps, shared by the ID Cards tap log, the Card
 * Readers page and the event views.
 *
 * Columns are switched off by the caller rather than by the data, because an
 * absent value means different things in different places: on the Card
 * Readers page the server clears whose card it was for a viewer who may not
 * see that, and a "Member" column of dashes would read as "nobody tapped".
 */

import React from 'react';
import { Link } from 'react-router';
import { formatDateTime } from '../../../utils/dateFormatting';
import {
  NFC_TAP_OUTCOME_LABELS,
  NFC_TAP_SOURCE_LABELS,
  NFC_TAP_TONE_COLORS,
  checkInResultTone,
} from '../constants/idCards';
import type { NfcCardTap } from '../types/idCard';

export interface CardTapColumns {
  member?: boolean;
  card?: boolean;
  where?: boolean;
  target?: boolean;
}

interface CardTapTableProps {
  taps: NfcCardTap[];
  tz: string;
  columns?: CardTapColumns;
  /** Header for the target column — "Checked into" on most screens. */
  targetLabel?: string;
}

const ALL_COLUMNS: Required<CardTapColumns> = { member: true, card: true, where: true, target: true };

const cardText = (tap: NfcCardTap): string => {
  if (tap.cardUidPreview) return `${tap.cardLabel || 'ID card'} …${tap.cardUidPreview}`;
  if (tap.unknownCardKey) return `Unknown card ${tap.unknownCardKey}`;
  return '—';
};

export const CardTapTable: React.FC<CardTapTableProps> = ({
  taps,
  tz,
  columns = ALL_COLUMNS,
  targetLabel = 'Checked into',
}) => (
  <table className="rwd-table w-full text-sm">
    <thead>
      <tr className="text-theme-text-secondary text-left">
        <th className="p-3">Time</th>
        <th className="p-3">Outcome</th>
        {columns.member && <th className="p-3">Member</th>}
        {columns.card && <th className="p-3">Card</th>}
        {columns.where && <th className="p-3">Where</th>}
        {columns.target && <th className="p-3">{targetLabel}</th>}
      </tr>
    </thead>
    <tbody className="divide-theme-surface-border divide-y">
      {taps.map((tap) => (
        <tr key={tap.id}>
          <td className="text-theme-text-secondary p-3 whitespace-nowrap" data-label="Time">
            {formatDateTime(tap.tappedAt, tz)}
          </td>
          <td className="p-3" data-label="Outcome">
            <span className={`badge ${NFC_TAP_TONE_COLORS[checkInResultTone(tap.outcome)]}`}>
              {NFC_TAP_OUTCOME_LABELS[tap.outcome]}
            </span>
          </td>
          {columns.member && (
            <td className="p-3" data-label="Member">
              {tap.userId && tap.memberName ? (
                <Link to={`/members/${tap.userId}`} className="text-theme-text-primary hover:underline">
                  {tap.memberName}
                </Link>
              ) : (
                <span className="text-theme-text-muted">—</span>
              )}
            </td>
          )}
          {columns.card && (
            <td className="text-theme-text-secondary p-3" data-label="Card">
              <span className="font-mono">{cardText(tap)}</span>
            </td>
          )}
          {columns.where && (
            <td className="text-theme-text-secondary p-3" data-label="Where">
              {NFC_TAP_SOURCE_LABELS[tap.source]}
              {tap.locationName ? ` · ${tap.locationName}` : ''}
              {tap.operatorName ? ` · run by ${tap.operatorName}` : ''}
            </td>
          )}
          {columns.target && (
            <td className="text-theme-text-secondary p-3" data-label={targetLabel}>
              {tap.targetName || '—'}
            </td>
          )}
        </tr>
      ))}
    </tbody>
  </table>
);
