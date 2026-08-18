/**
 * Version History — every rule modification creates a snapshot. Compare any
 * two versions side by side with highlighted differences and roll back with
 * one click (the rollback itself is recorded as a new version — history is
 * never deleted).
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { fetchRules, fetchVersions, rollbackToVersion, type RuleVersionRow } from '../../api/rulesEngine';
import { operatorLabel } from '../../lib/ruleFields';
import { useAuth } from '../../auth/AuthContext';

function condLabel(c: any) {
  return `${c.field} ${operatorLabel(c.operator)} ${String(c.value).replace(/^"|"$/g, '')}`;
}
function actLabel(a: any) {
  const type = a.actionType ?? a.action_type;
  const target = a.targetField ?? a.target_field;
  switch (type) {
    case 'set': return `Set ${target} = ${String(a.value ?? '').replace(/^"|"$/g, '')}`;
    case 'subtract': return `Subtract ${a.amount != null ? `₹${a.amount}` : a.percent != null ? `${a.percent}%` : ''} from ${target}`;
    case 'add': return `Add ${a.amount != null ? `₹${a.amount}` : a.percent != null ? `${a.percent}%` : ''} to ${target}`;
    case 'sendNotification': return `Notify (${a.notificationTemplate ?? a.notification_template}) ${(a.notificationRecipients ?? a.notification_recipients ?? '')}`;
    case 'calculate': return `${target} = ${a.formula}`;
    default: return `${type} ${target ?? ''}`.trim();
  }
}

export default function VersionsTab() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const actor = user?.email || 'user';
  const [ruleId, setRuleId] = useState<number | null>(null);
  const [leftV, setLeftV] = useState<number | null>(null);
  const [rightV, setRightV] = useState<number | null>(null);
  const [confirmRollback, setConfirmRollback] = useState<RuleVersionRow | null>(null);
  const [toast, setToast] = useState('');

  const { data: rules = [] } = useQuery({ queryKey: ['rules-engine', 'rules', 'all'], queryFn: () => fetchRules() });

  const selectedRule = ruleId ?? rules[0]?.id ?? null;

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['rules-engine', 'versions', selectedRule],
    queryFn: () => fetchVersions(selectedRule!),
    enabled: !!selectedRule,
  });

  // Default comparison: two most recent versions.
  const effectiveLeft = leftV ?? versions[1]?.version_number ?? versions[0]?.version_number ?? null;
  const effectiveRight = rightV ?? versions[0]?.version_number ?? null;
  const leftVer = versions.find((v) => v.version_number === effectiveLeft);
  const rightVer = versions.find((v) => v.version_number === effectiveRight);

  const diff = useMemo(() => {
    if (!leftVer || !rightVer) return null;
    const key = (c: any) => `${c.field}|${c.operator}|${String(c.value)}|${c.logicalOperator ?? c.logical_operator ?? ''}`;
    const akey = (a: any) => JSON.stringify({ t: a.actionType ?? a.action_type, f: a.targetField ?? a.target_field, v: a.value, amt: a.amount, pc: a.percent, tpl: a.notificationTemplate ?? a.notification_template });
    const condsL = new Set((leftVer.conditions || []).map(key));
    const condsR = new Set((rightVer.conditions || []).map(key));
    const actsL = new Set((leftVer.actions || []).map(akey));
    const actsR = new Set((rightVer.actions || []).map(akey));
    return {
      conditionsAdded: (rightVer.conditions || []).filter((c: any) => !condsL.has(key(c))),
      conditionsRemoved: (leftVer.conditions || []).filter((c: any) => !condsR.has(key(c))),
      actionsAdded: (rightVer.actions || []).filter((a: any) => !actsL.has(akey(a))),
      actionsRemoved: (leftVer.actions || []).filter((a: any) => !actsR.has(akey(a))),
      nameChanged: leftVer.name !== rightVer.name,
      descriptionChanged: (leftVer.description ?? '') !== (rightVer.description ?? ''),
    };
  }, [leftVer, rightVer]);

  const rollbackMutation = useMutation({
    mutationFn: (version: number) => rollbackToVersion(selectedRule!, version, actor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules-engine'] });
      setConfirmRollback(null);
      setToast('Rolled back — the rollback is saved as a new version');
      setTimeout(() => setToast(''), 4000);
    },
  });

  return (
    <div className="relative">
      {toast && (
        <div className="absolute top-2 right-2 z-30 flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 text-white text-sm shadow-lg">
          <span className="material-icons text-lg">history</span>{toast}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={selectedRule ?? ''}
          onChange={(e) => { setRuleId(Number(e.target.value)); setLeftV(null); setRightV(null); }}
          className="border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 min-w-[240px] flex-1 sm:flex-none"
        >
          {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {selectedRule && <span className="text-sm text-slate-500">{versions.length} version{versions.length === 1 ? '' : 's'} on record</span>}
      </div>

      {!selectedRule ? (
        <p className="text-center text-base text-slate-400 py-12">No rules exist yet — create one in Rule Management first.</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4 lg:gap-5">
          {/* Version list */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <p className="px-4 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-100 bg-slate-50">Versions</p>
            <div className="divide-y divide-slate-50 xl:max-h-[68vh] overflow-y-auto">
              {isLoading ? (
                [...Array(4)].map((_, i) => <div key={i} className="p-4 animate-pulse"><div className="h-4 bg-slate-100 rounded w-2/3 mb-2" /><div className="h-3.5 bg-slate-100 rounded w-1/2" /></div>)
              ) : versions.map((v) => (
                <div
                  key={v.id}
                  className={clsx('p-4 hover:bg-slate-50/70 cursor-pointer', (v.version_number === effectiveLeft || v.version_number === effectiveRight) && 'bg-purple-50/50')}
                  onClick={() => {
                    // Click cycles: first select left, then right, then reset.
                    if (effectiveLeft === v.version_number || effectiveRight === v.version_number) return;
                    if (leftV == null) setLeftV(v.version_number);
                    else if (rightV == null) setRightV(v.version_number);
                    else { setLeftV(v.version_number); setRightV(null); }
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white text-xs font-bold flex items-center justify-center shrink-0">v{v.version_number}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{v.change_summary ?? 'No summary'}</p>
                      <p className="text-xs text-slate-500">{v.modified_by} · {new Date(v.modified_at).toLocaleString()}</p>
                    </div>
                    {v.is_rollback && <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold shrink-0">ROLLBACK</span>}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setLeftV(v.version_number); }}
                      className={clsx('text-xs px-2.5 py-1 rounded-md border font-medium', effectiveLeft === v.version_number ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-500 hover:bg-slate-100')}
                    >Left</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setRightV(v.version_number); }}
                      className={clsx('text-xs px-2.5 py-1 rounded-md border font-medium', effectiveRight === v.version_number ? 'bg-violet-600 text-white border-violet-600' : 'border-slate-200 text-slate-500 hover:bg-slate-100')}
                    >Right</button>
                    {v.version_number !== versions[0]?.version_number && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmRollback(v); }}
                        className="ml-auto text-xs px-2.5 py-1 rounded-md bg-amber-500 text-white font-medium hover:bg-amber-600"
                      >↩ Rollback</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Comparison */}
          <div className="space-y-4">
            {leftVer && rightVer && diff ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[{ v: leftVer, tone: 'blue', label: 'Left' }, { v: rightVer, tone: 'violet', label: 'Right' }].map(({ v, tone, label }) => (
                    <div key={label} className={clsx('rounded-2xl border p-4 sm:p-5 bg-white', tone === 'blue' ? 'border-blue-200' : 'border-violet-200')}>
                      <div className="flex flex-wrap items-center gap-2 mb-2.5">
                        <span className={clsx('px-2.5 py-0.5 rounded-md text-xs font-bold text-white', tone === 'blue' ? 'bg-blue-600' : 'bg-violet-600')}>{label}</span>
                        <span className="text-base font-semibold text-slate-800">v{v.version_number}</span>
                        <span className="text-xs text-slate-400">{new Date(v.modified_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-700">{v.name}</p>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{v.description ?? 'No description'}</p>
                      <p className="text-xs text-slate-600 mt-2"><span className="font-semibold">Summary:</span> {v.change_summary ?? '—'}</p>
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-500 mb-1.5">IF conditions</p>
                        <ul className="space-y-1.5">
                          {(v.conditions || []).map((c: any, i: number) => <li key={i} className="text-xs text-slate-700 bg-blue-50/60 rounded-md px-2.5 py-1.5 leading-relaxed">{condLabel(c)}</li>)}
                        </ul>
                      </div>
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-500 mb-1.5">THEN actions</p>
                        <ul className="space-y-1.5">
                          {(v.actions || []).map((a: any, i: number) => <li key={i} className="text-xs text-slate-700 bg-emerald-50/60 rounded-md px-2.5 py-1.5 leading-relaxed">{actLabel(a)}</li>)}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Differences */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <h4 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
                    <span className="material-icons text-amber-500 text-xl">difference</span>
                    Differences (Left → Right)
                  </h4>
                  {diff.conditionsAdded.length === 0 && diff.conditionsRemoved.length === 0 && diff.actionsAdded.length === 0 && diff.actionsRemoved.length === 0 && !diff.nameChanged && !diff.descriptionChanged ? (
                    <p className="text-sm text-slate-500 bg-slate-50 rounded-lg px-3.5 py-3">No differences between these versions.</p>
                  ) : (
                    <div className="space-y-2 text-sm">
                      {diff.nameChanged && <DiffRow tone="changed" text={`Name: “${leftVer.name}” → “${rightVer.name}”`} />}
                      {diff.descriptionChanged && <DiffRow tone="changed" text="Description changed" />}
                      {diff.conditionsAdded.map((c: any, i: number) => <DiffRow key={`ca${i}`} tone="added" text={`+ Condition: ${condLabel(c)}`} />)}
                      {diff.conditionsRemoved.map((c: any, i: number) => <DiffRow key={`cr${i}`} tone="removed" text={`− Condition: ${condLabel(c)}`} />)}
                      {diff.actionsAdded.map((a: any, i: number) => <DiffRow key={`aa${i}`} tone="added" text={`+ Action: ${actLabel(a)}`} />)}
                      {diff.actionsRemoved.map((a: any, i: number) => <DiffRow key={`ar${i}`} tone="removed" text={`− Action: ${actLabel(a)}`} />)}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-base text-slate-400">
                <span className="material-icons block text-4xl mb-2 opacity-40">compare_arrows</span>
                Select a rule — the latest two versions are compared automatically. Use the Left / Right buttons to pick others.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rollback confirm */}
      {confirmRollback && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-slate-800 mb-1.5">Rollback to v{confirmRollback.version_number}</h3>
            <p className="text-sm text-slate-500 mb-2 leading-relaxed">The rule will be restored to this snapshot. Nothing is lost — the rollback is saved as a new version.</p>
            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3.5 py-2.5 mb-5">{confirmRollback.change_summary ?? 'No summary'} · {confirmRollback.modified_by}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmRollback(null)} className="flex-1 border border-slate-200 rounded-lg py-2.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={() => rollbackMutation.mutate(confirmRollback.version_number)} disabled={rollbackMutation.isPending} className="flex-1 bg-amber-500 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-amber-600 disabled:opacity-60">
                {rollbackMutation.isPending ? 'Rolling back…' : 'Rollback'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffRow({ tone, text }: { tone: 'added' | 'removed' | 'changed'; text: string }) {
  return (
    <p className={clsx('rounded-lg px-3.5 py-2 font-mono text-sm',
      tone === 'added' && 'bg-emerald-50 text-emerald-700',
      tone === 'removed' && 'bg-red-50 text-red-600',
      tone === 'changed' && 'bg-amber-50 text-amber-700',
    )}>{text}</p>
  );
}