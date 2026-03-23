/**
 * Inventory Status Report Renderer
 */

import React from 'react';
import type { InventoryStatusReport } from '../../types';
import { toStr } from '../../utils/export';
import { ReportTable } from '../ReportTable';
import { StatCard } from '../StatCard';
import { formatNumber } from '@/utils/dateFormatting';

interface Props {
  data: InventoryStatusReport;
}

export const InventoryStatusRenderer: React.FC<Props> = ({ data }) => {
  const columns = [
    { key: 'name', header: 'Item' },
    {
      key: 'item_type',
      header: 'Type',
      render: (v: unknown) => <span className="capitalize">{toStr(v, '-')}</span>,
    },
    { key: 'category_name', header: 'Category' },
    { key: 'total_quantity', header: 'Total', align: 'right' as const },
    { key: 'assigned_quantity', header: 'Assigned', align: 'right' as const },
    { key: 'available_quantity', header: 'Available', align: 'right' as const },
    {
      key: 'condition',
      header: 'Condition',
      render: (v: unknown) => <span className="capitalize">{toStr(v, '-')}</span>,
    },
    {
      key: 'is_low_stock',
      header: 'Low Stock',
      align: 'center' as const,
      render: (v: unknown) =>
        v === true ? (
          <span className="rounded-sm bg-red-500/20 px-2 py-0.5 text-xs text-red-700 dark:text-red-300">Low</span>
        ) : (
          <span className="text-theme-text-muted text-xs">OK</span>
        ),
    },
    { key: 'last_audit_date', header: 'Last Audit' },
  ];

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Items" value={data.total_items} />
        <StatCard label="Low Stock" value={data.low_stock_count} />
        <StatCard label="Assigned" value={data.assigned_count} />
        {data.total_value != null && <StatCard label="Total Value" value={`$${formatNumber(data.total_value)}`} />}
      </div>
      <ReportTable
        rows={data.entries as unknown as Array<Record<string, unknown>>}
        columns={columns}
        emptyMessage="No inventory items found."
      />
    </div>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function getInventoryStatusExportData(data: InventoryStatusReport) {
  const columns = [
    { key: 'name', header: 'Item' },
    { key: 'item_type', header: 'Type' },
    { key: 'category_name', header: 'Category' },
    { key: 'total_quantity', header: 'Total Qty' },
    { key: 'assigned_quantity', header: 'Assigned' },
    { key: 'available_quantity', header: 'Available' },
    { key: 'condition', header: 'Condition' },
    { key: 'is_low_stock', header: 'Low Stock' },
    { key: 'last_audit_date', header: 'Last Audit' },
  ];
  return { rows: data.entries as unknown as Array<Record<string, unknown>>, columns };
}
