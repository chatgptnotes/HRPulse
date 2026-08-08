import { useEffect } from 'react';

/** Rows on one page of any list. One number so the tabs cannot drift apart. */
export const PAGE_SIZE = 10;

interface Props {
  /** How many rows the filters left, before slicing. */
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** What the rows are called, for the "1–25 of 339 employees" line. */
  noun?: string;
}

/**
 * The footer under a long list: which slice is on screen, and the way to the
 * next one. Sits bottom right on every table that uses it, so the control is
 * always in the same corner whichever page you are on.
 */
export default function TablePagination({ total, page, pageSize, onPageChange, noun = 'rows' }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Narrowing a filter can strand the reader on a page that no longer exists —
  // page 6 of a list that is now two pages long renders as an empty table.
  useEffect(() => {
    if (page > totalPages) onPageChange(totalPages);
  }, [page, totalPages, onPageChange]);

  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-4 py-3 text-[10px] text-slate-400">
      <span>Showing {first}–{last} of {total} {noun}</span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
          className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
        >‹</button>
        <span className="rounded bg-indigo-600 px-2 py-1 text-white">{page}</span>
        <span className="px-1 py-1">of {totalPages}</span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
          className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
        >›</button>
      </div>
    </div>
  );
}
