/**
 * Rule Logs — complete execution audit trail with filters, pagination, a
 * detail drawer and CSV / Excel / JSON / PDF export.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import * as XLSX from 'xlsx';
import { fetchLogs, fetchRules, type RuleLogRow } from '../../api/rulesEngine';

const PAGE_SIZE = 25;

const statusStyle = (status: string) => {
  switch (status) {
    case 'success': return 'bg-emerald-100 text-emerald-700';
    case 'failed': return 'bg-red-100 text-red-700';
    case 'partial': return 'bg-amber-100 text-amber-700';
    default: return 'bg-slate-100 text-slate-500';
  }
};

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LogsTab() {
  const [ruleFilter, setRuleFilter] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<RuleLogRow | null>(null);

  const { data: rules = [] } = useQuery({ queryKey: ['rules-engine', 'rules', 'all'], queryFn: () => fetchRules() });

  const filters = {
    ruleId: ruleFilter === 'all' ? undefined : ruleFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
    page,
    limit: PAGE_SIZE,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['rules-engine', 'logs', filters],
    queryFn: () => fetchLogs(filters),
    placeholderData: (prev) => prev,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const ruleName = (id: number) => (logs.find((l) => l.rule_id === id)?.rules as any)?.name ?? rules.find((r) => r.id === id)?.name ?? `Rule #${id}`;

  const exportRows = (): Array<Record<string, string | number>> => logs.map((l) => ({
    'Execution ID': l.id,
    'Rule Name': ruleName(l.rule_id),
    'Employee': l.employee_name ?? (l.employee_id ? `#${l.employee_id}` : '—'),
    'Executed At': new Date(l.executed_at).toLocaleString(),
    'Status': l.status,
    'Trigger': l.trigger_source ?? '—',
    'Duration (ms)': l.execution_duration ?? '—',
    'Executed By': l.executed_by ?? '—',
    'Batch': l.batch_id ?? '—',
    'Error': l.error_message ?? '',
  }));

  const exportCsv = () => {
    const rows = exportRows();
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    downloadBlob(csv, `rule-logs-${Date.now()}.csv`, 'text/csv;charset=utf-8');
  };

  const exportExcel = () => {
    const rows = exportRows();
    if (!rows.length) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rule Logs');
    XLSX.writeFile(wb, `rule-logs-${Date.now()}.xlsx`);
  };

  const exportJson = () => downloadBlob(JSON.stringify(logs, null, 2), `rule-logs-${Date.now()}.json`, 'application/json');

  const exportPdf = () => {
    // Print-window PDF: styled table with per-section page breaks.
    const rows = exportRows();
    const html = `<html><head><title>Rule Execution Logs</title><style>
      body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#1e293b}
      h1{font-size:18px} p{color:#64748b;font-size:12px}
      table{width:100%;border-collapse:collapse;font-size:10px;margin-top:12px}
      th{background:#e2e8f0;text-align:left;padding:6px 8px}
      td{border-bottom:1px solid #e2e8f0;padding:6px 8px;vertical-align:top}
      .failed{color:#dc2626;font-weight:600}.success{color:#059669;font-weight:600}
      @media print{body{padding:0}}
    </style></head><body>
      <h1>HRPulse — Rule Execution Logs</h1>
      <p>Generated ${new Date().toLocaleString()} · ${rows.length} rows ${ruleFilter !== 'all' ? `· Rule: ${ruleName(ruleFilter as number)}` : ''} ${statusFilter !== 'all' ? `· Status: ${statusFilter}` : ''}</p>
      <table><thead><tr>${Object.keys(rows[0] ?? { Info: '' }).map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${Object.values(r).map((v) => `<td class="${r.Status === 'failed' ? 'failed' : r.Status === 'success' ? 'success' : ''}">${String(v ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </body></html>`;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 400);
  };

  const inputCls = 'border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/40';

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2.5 mb-4">
        <select value={ruleFilter === 'all' ? 'all' : String(ruleFilter)} onChange={(e) => { setRuleFilter(e.target.value === 'all' ? 'all' : Number(e.target.value)); setPage(1); }} className={clsx(inputCls, 'min-w-[160px]')}>
          <option value="all">All rules</option>
          {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={inputCls}>
          <option value="all">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="partial">Partial</option>
          <option value="skipped">Skipped</option>
        </select>
        <label className="text-sm text-slate-500">From <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className={clsx(inputCls, 'ml-1')} /></label>
        <label className="text-sm text-slate-500">To <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className={clsx(inputCls, 'ml-1')} /></label>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-sm text-slate-400 mr-1">Export page:</span>
          {[
            { label: 'CSV', fn: exportCsv, icon: 'table_view' },
            { label: 'Excel', fn: exportExcel, icon: 'grid_on' },
            { label: 'JSON', fn: exportJson, icon: 'data_object' },
            { label: 'PDF', fn: exportPdf, icon: 'picture_as_pdf' },
          ].map((x) => (
            <button key={x.label} onClick={x.fn} disabled={!logs.length} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              <span className="material-icons text-base">{x.icon}</span>{x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 [scrollbar-width:thin]">
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['Rule', 'Employee', 'Executed At', 'Status', 'Trigger', 'Duration', 'Executed By', ''].map((h) => (
                <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              [...Array(8)].map((_, i) => <tr key={i}><td colSpan={8} className="px-3.5 py-3.5"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td></tr>)
            ) : logs.length === 0 ? (
              <tr><td colSpan={8} className="px-3.5 py-12 text-center text-sm text-slate-400">
                <span className="material-icons block text-4xl mb-2 opacity-40">receipt_long</span>
                No execution logs yet. Run rules in the Testing Sandbox or trigger executions to populate the audit trail.
              </td></tr>
            ) : logs.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/70 cursor-pointer" onClick={() => setDetail(l)}>
                <td className="px-5 py-3.5 font-medium text-slate-800 max-w-[340px] truncate" title={ruleName(l.rule_id)}>{ruleName(l.rule_id)}</td>
                <td className="px-5 py-3.5 text-slate-600 max-w-[200px] truncate" title={l.employee_name ?? ''}>{l.employee_name ?? (l.employee_id ? `#${l.employee_id}` : '—')}</td>
                <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">{new Date(l.executed_at).toLocaleString()}</td>
                <td className="px-5 py-3.5"><span className={clsx('px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize', statusStyle(l.status))}>{l.status}</span></td>
                <td className="px-5 py-3.5 text-slate-500 capitalize">{l.trigger_source?.replace('_', ' ') ?? '—'}</td>
                <td className="px-5 py-3.5 text-slate-500">{l.execution_duration != null ? `${l.execution_duration}ms` : '—'}</td>
                <td className="px-5 py-3.5 text-slate-500 max-w-[200px] truncate" title={l.executed_by ?? ''}>{l.executed_by ?? '—'}</td>
                <td className="px-5 py-3.5"><span className="material-icons text-slate-400 text-lg">chevron_right</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-3 text-sm text-slate-500">
        <span>{total.toLocaleString()} record{total === 1 ? '' : 's'} · page {page} of {totalPages}</span>
        <div className="flex gap-1.5">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">Previous</button>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">Next</button>
        </div>
      </div>

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setDetail(null)}>
          <div className="bg-white w-full max-w-lg h-full overflow-y-auto p-5 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">Execution #{detail.id}</h3>
              <button onClick={() => setDetail(null)} className="p-2 rounded-lg hover:bg-slate-100"><span className="material-icons text-slate-400">close</span></button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
              {[
                ['Rule', ruleName(detail.rule_id)],
                ['Employee', detail.employee_name ?? (detail.employee_id ? `#${detail.employee_id}` : '—')],
                ['Status', detail.status],
                ['Trigger', detail.trigger_source ?? '—'],
                ['Duration', detail.execution_duration != null ? `${detail.execution_duration}ms` : '—'],
                ['Executed By', detail.executed_by ?? '—'],
                ['Executed At', new Date(detail.executed_at).toLocaleString()],
                ['Batch', detail.batch_id ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 px-3.5 py-2.5">
                  <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">{k}</p>
                  <p className="text-slate-800 mt-0.5 capitalize">{v}</p>
                </div>
              ))}
            </div>
            {detail.error_message && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3.5 py-2.5 leading-relaxed">{detail.error_message}</p>}
            {[
              ['Matched Conditions', detail.matched_conditions],
              ['Executed Actions', detail.executed_actions],
              ['Input Data', detail.input_data],
              ['Output Data', detail.output_data],
            ].map(([label, value]) => value ? (
              <div key={label as string}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{label as string}</p>
                <pre className="text-xs font-mono bg-slate-900 text-emerald-300 rounded-xl p-3.5 overflow-x-auto max-h-56">{JSON.stringify(value, null, 2)}</pre>
              </div>
            ) : null)}
          </div>
        </div>
      )}
    </div>
  );
}
