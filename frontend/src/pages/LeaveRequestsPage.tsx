import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  decideLeaveRequest,
  getLeaveRequests,
  LeaveRequest,
  LeaveStatus,
  saveLeaveBalance,
} from '../api';

type Filter = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS: Record<string, { label: string; icon: string; chip: string; tone: string }> = {
  pending: { label: 'Pending', icon: 'schedule', chip: 'bg-amber-50 text-amber-700 ring-amber-100', tone: 'from-amber-500 to-orange-500' },
  approved: { label: 'Approved', icon: 'check_circle', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100', tone: 'from-emerald-500 to-teal-500' },
  rejected: { label: 'Rejected', icon: 'cancel', chip: 'bg-rose-50 text-rose-700 ring-rose-100', tone: 'from-rose-500 to-red-500' },
  cancelled: { label: 'Cancelled', icon: 'block', chip: 'bg-slate-100 text-slate-600 ring-slate-200', tone: 'from-slate-500 to-slate-600' },
};

function Icon({ name, className = 'text-base' }: { name: string; className?: string }) {
  return <span className={clsx('material-icons leading-none', className)}>{name}</span>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'HR';
}

function date(value: string | null) {
  if (!value) return '-';
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusChip({ status }: { status: LeaveStatus }) {
  const meta = STATUS[status] || STATUS.pending;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1', meta.chip)}>
      <Icon name={meta.icon} className="text-sm" />{meta.label}
    </span>
  );
}

function SummaryButton({ filter, active, count, onClick }: { filter: Filter; active: boolean; count: number; onClick: () => void }) {
  const meta = filter === 'all'
    ? { label: 'All requests', icon: 'event_note', tone: 'from-indigo-500 to-violet-600' }
    : STATUS[filter];
  return (
    <button onClick={onClick} className={clsx(
      'flex items-center justify-between rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg',
      active ? 'border-indigo-300 ring-4 ring-indigo-100' : 'border-slate-200/70',
    )}>
      <div><p className="text-xs font-bold uppercase text-slate-400">{meta.label}</p><p className="mt-1 text-3xl font-bold text-slate-950">{count}</p></div>
      <div className={clsx('flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md', meta.tone)}><Icon name={meta.icon} className="text-xl" /></div>
    </button>
  );
}

export default function LeaveRequestsPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const employeeId = Number(params.get('employeeId')) || undefined;
  const [filter, setFilter] = useState<Filter>('pending');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  const [notes, setNotes] = useState('');
  const [balanceValue, setBalanceValue] = useState('');
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const showToast = (message: string, error = false) => {
    setToast({ message, error });
    window.setTimeout(() => setToast(null), 3500);
  };

  const { data: requests = [], isLoading, error } = useQuery({
    queryKey: ['leave-requests', employeeId || 'all'],
    queryFn: () => getLeaveRequests(employeeId ? { employeeId } : undefined).then(r => r.data),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!selected) return;
    const current = requests.find(item => item.id === selected.id);
    if (current && current !== selected) setSelected(current);
  }, [requests, selected]);

  const counts = useMemo(() => ({
    all: requests.length,
    pending: requests.filter(item => item.status === 'pending').length,
    approved: requests.filter(item => item.status === 'approved').length,
    rejected: requests.filter(item => item.status === 'rejected').length,
  }), [requests]);

  const visible = useMemo(() => requests.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
    const q = search.trim().toLowerCase();
    return !q || `${item.employee?.name || ''} ${item.employee?.employeeNumber || ''} ${item.employee?.department || ''} ${item.leaveType}`.toLowerCase().includes(q);
  }), [filter, requests, search]);

  const openRequest = (item: LeaveRequest) => {
    setSelected(item);
    setNotes(item.approverNotes || '');
    setBalanceValue(item.balance ? String(item.balance.available) : '');
  };

  const balanceMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No request selected');
      const year = Number(selected.startDate.slice(0, 4));
      return saveLeaveBalance(selected.employeeId, { leaveType: selected.leaveType, periodYear: year, available: Number(balanceValue) });
    },
    onSuccess: ({ data }) => {
      setSelected(current => current ? { ...current, balance: data } : current);
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['employee-leaves', selected?.employeeId] });
      showToast('Leave balance saved');
    },
    onError: (err: any) => showToast(err?.response?.data?.error || err.message || 'Could not save balance', true),
  });

  const decisionMutation = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => {
      if (!selected) throw new Error('No request selected');
      return decideLeaveRequest(selected.id, { decision, approverNotes: notes, decidedBy: 'HR Admin' });
    },
    onSuccess: ({ data }) => {
      setSelected(data.request);
      qc.invalidateQueries({ queryKey: ['leave-requests'] });
      qc.invalidateQueries({ queryKey: ['employee-leaves', data.request.employeeId] });
      showToast(`Leave request ${data.request.status}`);
    },
    onError: (err: any) => showToast(err?.response?.data?.error || err.message || 'Decision failed', true),
  });

  const balanceReady = !!selected?.balance && selected.balance.available >= selected.days;

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-7">
      {toast && <div className={clsx('fixed right-5 top-5 z-[70] rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-xl', toast.error ? 'bg-rose-600' : 'bg-emerald-600')}>{toast.message}</div>}

      <div className="mx-auto max-w-[1500px]">
        <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Employee self-service</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">Leave Requests</h1>
            <p className="mt-1 text-sm text-slate-500">Review applications, maintain balances, and record decisions.</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Auto-refreshes every minute
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(['all', 'pending', 'approved', 'rejected'] as Filter[]).map(key => <SummaryButton key={key} filter={key} active={filter === key} count={counts[key]} onClick={() => setFilter(key)} />)}
        </div>

        <div className="mt-6 flex flex-col gap-3 border-y border-slate-200 py-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-md">
            <Icon name="search" className="absolute left-3 top-3 text-lg text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee, ID, department or leave type" className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" />
          </div>
          <p className="text-sm font-medium text-slate-500">Showing {visible.length} request{visible.length === 1 ? '' : 's'}</p>
        </div>

        <section className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {isLoading ? <div className="py-20 text-center text-slate-400"><Icon name="sync" className="animate-spin text-3xl" /><p className="mt-2 text-sm">Loading requests...</p></div>
          : error ? <div className="mx-auto max-w-xl py-20 text-center text-rose-600"><Icon name="error_outline" className="text-3xl" /><p className="mt-2 text-sm font-semibold">Could not load leave requests</p><p className="mt-2 text-xs leading-5 text-slate-500">{(error as any)?.response?.data?.error || (error as Error).message}</p></div>
          : visible.length === 0 ? <div className="py-20 text-center text-slate-400"><Icon name="event_available" className="text-5xl text-slate-200" /><p className="mt-2 font-semibold">No {filter === 'all' ? '' : filter} requests</p></div>
          : <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-400"><tr><th className="px-5 py-3">Employee</th><th className="px-4 py-3">Leave</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Days</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(item => <tr key={item.id} className="hover:bg-slate-50/80">
                  <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 font-bold text-indigo-700">{initials(item.employee?.name || '')}</div><div><p className="font-semibold text-slate-900">{item.employee?.name || `Employee ${item.employeeId}`}</p><p className="text-xs text-slate-400">{item.employee?.employeeNumber || '-'} · {item.employee?.department || 'No department'}</p></div></div></td>
                  <td className="px-4 py-4 font-semibold text-slate-700">{item.leaveType}</td>
                  <td className="px-4 py-4 text-slate-600"><p>{date(item.startDate)}</p><p className="text-xs text-slate-400">to {date(item.endDate)}</p></td>
                  <td className="px-4 py-4 font-bold text-slate-900">{item.days}</td>
                  <td className="px-4 py-4"><span className={clsx('font-bold', item.balance && item.balance.available >= item.days ? 'text-emerald-700' : 'text-amber-700')}>{item.balance ? item.balance.available : 'Not set'}</span></td>
                  <td className="px-4 py-4 text-slate-500">{date(item.requestedAt)}</td>
                  <td className="px-4 py-4"><StatusChip status={item.status} /></td>
                  <td className="px-4 py-4 text-right"><button onClick={() => openRequest(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700">Review</button></td>
                </tr>)}
              </tbody>
            </table>
          </div>}
        </section>
      </div>

      {selected && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-sm">
        <button aria-label="Close request" onClick={() => setSelected(null)} className="hidden flex-1 md:block" />
        <aside className="flex h-full w-full max-w-xl flex-col bg-slate-50 shadow-2xl animate-slide-in-right">
          <header className="border-b border-slate-200 bg-white px-5 py-4"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase text-indigo-600">Request #{selected.id}</p><h2 className="text-xl font-bold text-slate-950">{selected.employee?.name || `Employee ${selected.employeeId}`}</h2><p className="text-sm text-slate-500">{selected.employee?.employeeNumber} · {selected.employee?.department || 'No department'}</p></div><button onClick={() => setSelected(null)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"><Icon name="close" className="text-xl" /></button></div></header>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <section className="rounded-2xl bg-slate-950 p-5 text-white"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase text-indigo-300">{selected.leaveType}</p><p className="mt-2 text-lg font-bold">{date(selected.startDate)} to {date(selected.endDate)}</p><p className="mt-1 text-sm text-slate-300">{selected.days} calendar day{selected.days === 1 ? '' : 's'}</p></div><StatusChip status={selected.status} /></div></section>
            <section className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="text-sm font-bold text-slate-900">Reason</h3><p className="mt-2 text-sm leading-6 text-slate-600">{selected.reason || 'No reason provided.'}</p></section>
            <section className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between"><div><h3 className="text-sm font-bold text-slate-900">{selected.leaveType} balance</h3><p className="text-xs text-slate-400">Year {selected.startDate.slice(0, 4)}</p></div>{selected.balance && <span className="text-2xl font-bold text-emerald-700">{selected.balance.available}</span>}</div>{selected.balance && <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-slate-50 p-2"><p className="font-bold">{selected.balance.used}</p><p className="text-xs text-slate-400">Used</p></div><div className="rounded-xl bg-amber-50 p-2"><p className="font-bold text-amber-700">{selected.balance.pending}</p><p className="text-xs text-slate-400">Pending</p></div><div className="rounded-xl bg-emerald-50 p-2"><p className="font-bold text-emerald-700">{selected.balance.available}</p><p className="text-xs text-slate-400">Available</p></div></div>} {selected.status === 'pending' && <div className="mt-4 flex gap-2"><input type="number" min="0" step="0.5" value={balanceValue} onChange={e => setBalanceValue(e.target.value)} placeholder="Set available balance" className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-indigo-400" /><button onClick={() => balanceMutation.mutate()} disabled={balanceMutation.isPending || balanceValue === '' || Number(balanceValue) < 0} className="rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">{balanceMutation.isPending ? 'Saving...' : 'Save balance'}</button></div>}</section>
            <section className="rounded-2xl border border-slate-200 bg-white p-4"><label className="text-sm font-bold text-slate-900">Approver notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={selected.status !== 'pending'} rows={4} placeholder="Add a reason or instruction for the employee" className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-indigo-400 disabled:opacity-70" />{selected.decidedAt && <p className="mt-2 text-xs text-slate-400">Decided by {selected.decidedBy || 'HR'} on {date(selected.decidedAt)}</p>}</section>
            {selected.status === 'pending' && !balanceReady && <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><Icon name="warning_amber" className="mt-0.5" /><span>{!selected.balance ? 'Set this employee’s leave balance before approval.' : `${selected.days} days requested but only ${selected.balance.available} available.`}</span></div>}
          </div>
          {selected.status === 'pending' && <footer className="grid grid-cols-2 gap-3 border-t border-slate-200 bg-white p-5"><button onClick={() => decisionMutation.mutate('rejected')} disabled={decisionMutation.isPending} className="h-11 rounded-xl border border-rose-200 bg-rose-50 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"><Icon name="close" className="mr-1 align-middle" />Reject</button><button onClick={() => decisionMutation.mutate('approved')} disabled={decisionMutation.isPending || !balanceReady} className="h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"><Icon name="check" className="mr-1 align-middle" />Approve</button></footer>}
        </aside>
      </div>}
    </div>
  );
}
