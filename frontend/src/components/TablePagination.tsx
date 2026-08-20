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
    <div className="flex flex-nowrap items-center justify-between gap-2 border-t-2 border-slate-200 bg-gradient-to-r from-slate-50 to-white px-3 py-2.5 text-[10px] text-slate-600 sm:flex-wrap sm:gap-4 sm:px-5 sm:py-4 sm:text-xs">
      <span className="font-medium text-slate-700">Showing <span className="font-bold text-purple-700">{first}</span>–<span className="font-bold text-purple-700">{last}</span> of <span className="font-bold text-purple-700">{total}</span> {noun}</span>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-purple-400 hover:bg-purple-50 transition-all shadow-sm disabled:shadow-none sm:px-3 sm:py-2"
        >
          <span className="material-icons text-lg">chevron_left</span>
        </button>
        <span className="rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 px-2.5 py-1.5 text-white font-bold shadow-md shadow-purple-500/30 sm:px-4 sm:py-2">{page}</span>
        <span className="whitespace-nowrap font-semibold text-slate-500">of {totalPages}</span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-purple-400 hover:bg-purple-50 transition-all shadow-sm disabled:shadow-none sm:px-3 sm:py-2"
        >
          <span className="material-icons text-lg">chevron_right</span>
        </button>
      </div>
    </div>
  );
}
