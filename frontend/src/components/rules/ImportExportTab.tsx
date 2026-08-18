/**
 * Import / Export — move rules between environments. Export selected rules as
 * JSON / CSV / XML; import with validation preview before anything is saved.
 * Cloning is available per-rule in Rule Management.
 */

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { fetchRules, exportRules, importRules, type ExportedRule } from '../../api/rulesEngine';

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toXml(rules: ExportedRule[]): string {
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
  const items = rules.map((r) => `  <rule>
    <name>${esc(r.name)}</name>
    <description>${esc(r.description)}</description>
    <category>${esc(r.category)}</category>
    <ruleType>${esc(r.ruleType)}</ruleType>
    <priority>${r.priority}</priority>
    <executionMode>${esc(r.executionMode)}</executionMode>
    <isActive>${r.isActive}</isActive>
    <conditions>${(r.conditions || []).map((c: any) => `
      <condition field="${esc(c.field)}" operator="${esc(c.operator)}" valueType="${esc(c.valueType ?? c.value_type)}" logicalOperator="${esc(c.logicalOperator ?? c.logical_operator ?? '')}">${esc(c.value)}</condition>`).join('')}
    </conditions>
    <actions>${(r.actions || []).map((a: any) => `
      <action type="${esc(a.actionType ?? a.action_type)}" targetField="${esc(a.targetField ?? a.target_field)}" amount="${esc(a.amount)}" percent="${esc(a.percent)}" value="${esc(a.value)}" template="${esc(a.notificationTemplate ?? a.notification_template)}"/>`).join('')}
    </actions>
  </rule>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rulesEngineExport generated="${new Date().toISOString()}" count="${rules.length}">\n${items}\n</rulesEngineExport>`;
}

function toCsv(rules: ExportedRule[]): string {
  const headers = ['name', 'description', 'category', 'ruleType', 'priority', 'executionMode', 'isActive', 'conditions', 'actions'];
  const lines = [headers.join(',')];
  for (const r of rules) {
    lines.push(headers.map((h) => `"${String((r as any)[h] ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`).join(','));
  }
  return lines.join('\n');
}

export default function ImportExportTab({ onChanged }: { onChanged?: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pendingImport, setPendingImport] = useState<ExportedRule[] | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [error, setError] = useState('');

  const { data: rules = [], isLoading } = useQuery({ queryKey: ['rules-engine', 'rules', 'all'], queryFn: () => fetchRules() });

  const toggle = (id: number) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((s) => (s.size === rules.length ? new Set() : new Set(rules.map((r) => r.id))));

  const doExport = async (format: 'json' | 'csv' | 'xml') => {
    const ids = selected.size ? [...selected] : undefined;
    const data = await exportRules(ids);
    if (!data.length) { setError('No rules to export.'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') downloadBlob(JSON.stringify(data, null, 2), `hrpulse-rules-${stamp}.json`, 'application/json');
    if (format === 'csv') downloadBlob(toCsv(data), `hrpulse-rules-${stamp}.csv`, 'text/csv;charset=utf-8');
    if (format === 'xml') downloadBlob(toXml(data), `hrpulse-rules-${stamp}.xml`, 'application/xml');
  };

  const onFile = async (file: File) => {
    setError(''); setResult(null);
    try {
      const text = await file.text();
      let parsed: any;
      if (/\.json$/i.test(file.name)) parsed = JSON.parse(text);
      else if (/\.xml$/i.test(file.name)) {
        // Minimal XML extraction for our own export shape.
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        parsed = [...doc.querySelectorAll('rule')].map((el) => ({
          name: el.querySelector('name')?.textContent ?? '',
          description: el.querySelector('description')?.textContent ?? null,
          category: el.querySelector('category')?.textContent ?? '',
          ruleType: el.querySelector('ruleType')?.textContent ?? 'custom',
          priority: Number(el.querySelector('priority')?.textContent ?? 10),
          executionMode: el.querySelector('executionMode')?.textContent ?? 'sync',
          isActive: el.querySelector('isActive')?.textContent === 'true',
          conditions: [...el.querySelectorAll('condition')].map((c) => ({
            field: c.getAttribute('field'), operator: c.getAttribute('operator'),
            value: c.textContent ?? '', valueType: c.getAttribute('valueType'),
            logicalOperator: c.getAttribute('logicalOperator') || undefined,
          })),
          actions: [...el.querySelectorAll('action')].map((a) => ({
            actionType: a.getAttribute('type'), targetField: a.getAttribute('targetField'),
            amount: a.getAttribute('amount') && a.getAttribute('amount') !== 'null' ? Number(a.getAttribute('amount')) : null,
            percent: a.getAttribute('percent') && a.getAttribute('percent') !== 'null' ? Number(a.getAttribute('percent')) : null,
            value: a.getAttribute('value') !== 'null' ? a.getAttribute('value') : null,
            notificationTemplate: a.getAttribute('template') !== 'null' ? a.getAttribute('template') : null,
          })),
        }));
      } else throw new Error('Unsupported file type — use the JSON or XML export format.');
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('No rules found in the file.');
      setPendingImport(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importMutation = useMutation({
    mutationFn: () => importRules(pendingImport!, { overwrite }),
    onSuccess: (res) => {
      setResult(res);
      setPendingImport(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['rules-engine'] });
      onChanged?.();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* EXPORT */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 mb-1.5">
          <span className="material-icons text-xl text-purple-500">file_upload</span>Export Rules
        </h3>
        <p className="text-sm text-slate-500 mb-4 leading-relaxed">
          {selected.size ? `${selected.size} rule${selected.size === 1 ? '' : 's'} selected` : 'All rules will be exported'}. JSON round-trips losslessly; CSV is for review.
        </p>

        <div className="rounded-xl border border-slate-200 overflow-hidden mb-3 max-h-96 overflow-y-auto [scrollbar-width:thin]">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={selected.size === rules.length && rules.length > 0} onChange={toggleAll} className="h-4 w-4 accent-purple-600" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Rule</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoading ? (
                <tr><td colSpan={4} className="px-3 py-5 text-center text-sm text-slate-400">Loading…</td></tr>
              ) : rules.map((r) => (
                <tr key={r.id} className={clsx('cursor-pointer hover:bg-slate-50', selected.has(r.id) && 'bg-purple-50/50')} onClick={() => toggle(r.id)}>
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} className="h-4 w-4 accent-purple-600" /></td>
                  <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-slate-500">{r.rule_categories?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold', r.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>{r.is_active ? 'Yes' : 'No'}</span>
                  </td>
                </tr>
              ))}
              {!isLoading && rules.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-400">No rules yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2">
          {[
            { label: 'JSON', icon: 'data_object', fn: () => doExport('json') },
            { label: 'CSV', icon: 'table_view', fn: () => doExport('csv') },
            { label: 'XML', icon: 'code', fn: () => doExport('xml') },
          ].map((x) => (
            <button key={x.label} onClick={() => void x.fn()} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <span className="material-icons text-base text-purple-500">{x.icon}</span>{x.label}
            </button>
          ))}
        </div>
      </div>

      {/* IMPORT */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-800 mb-1.5">
          <span className="material-icons text-xl text-indigo-500">file_download</span>Import Rules
        </h3>
        <p className="text-sm text-slate-500 mb-4 leading-relaxed">Upload a JSON or XML export. Rules are validated and previewed before anything is saved.</p>

        <label
          className="flex flex-col items-center justify-center gap-2.5 border-2 border-dashed border-slate-300 rounded-xl p-8 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}
        >
          <span className="material-icons text-4xl text-slate-400">upload_file</span>
          <span className="text-sm text-slate-500">Drop a .json / .xml file here, or click to browse</span>
          <input ref={fileRef} type="file" accept=".json,.xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        </label>

        {error && <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-lg px-3.5 py-2.5 leading-relaxed">{error}</p>}

        {result && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold mb-1">Import complete</p>
            <p>Imported {result.imported} · Skipped {result.skipped}{result.errors.length ? ` · Failed ${result.errors.length}` : ''}</p>
            {result.errors.length > 0 && (
              <ul className="mt-1.5 space-y-1 text-red-700">
                {result.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            )}
          </div>
        )}

        {pendingImport && (
          <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
            <p className="text-sm font-semibold text-indigo-900 mb-2.5">Preview — {pendingImport.length} rule{pendingImport.length === 1 ? '' : 's'} found</p>
            <div className="max-h-48 overflow-y-auto space-y-2 mb-3 [scrollbar-width:thin]">
              {pendingImport.map((r, i) => (
                <div key={i} className="flex items-center justify-between bg-white rounded-lg px-3.5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">{r.name}</p>
                    <p className="text-xs text-slate-500">{r.category} · {r.ruleType} · {(r.conditions || []).length} conditions · {(r.actions || []).length} actions</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0 ml-2">P{r.priority}</span>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2.5 text-sm text-slate-600 mb-3 cursor-pointer">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
              Overwrite existing rules with the same name
            </label>
            <div className="flex gap-2">
              <button onClick={() => setPendingImport(null)} className="flex-1 border border-slate-200 rounded-lg py-2.5 text-sm text-slate-600 hover:bg-white">Cancel</button>
              <button onClick={() => importMutation.mutate()} disabled={importMutation.isPending} className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:shadow-lg disabled:opacity-60">
                {importMutation.isPending ? 'Importing…' : `Import ${pendingImport.length} rule${pendingImport.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}