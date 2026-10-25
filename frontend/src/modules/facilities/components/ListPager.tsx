/**
 * Page controls under a facilities record list, shown only when the matching
 * records run past one page. The total is the server's organization-wide
 * count for the current filters, so the list says when there is more rather
 * than quietly stopping at the first page (FAC2-5).
 */

import React from 'react';
import { Pagination } from '../../../components/ux';

interface ListPagerProps {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

const ListPager: React.FC<ListPagerProps> = ({ page, total, pageSize, onPageChange }) =>
  total > pageSize ? (
    <Pagination currentPage={page} totalItems={total} pageSize={pageSize} onPageChange={onPageChange} />
  ) : null;

export default ListPager;
