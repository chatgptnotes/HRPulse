/**
 * Settings — maker-checker approval workflow (pending approvals queue with
 * approve/reject + comments), role-based access matrix and engine defaults.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { fetchApprovals, decideApproval, fetchRulePermissions, upsertRulePermission, fetchRules, fetchAiHistory } from '../../api/rulesEngine';
import { useAuth } from '../../auth/AuthContext';

const ROLES = [
  { value: 'admin', label: 'Super Administrator', hint: 'Full access to every module' },
  { value: 'hr_manager', label: 'HR Manager', hint: 'Attendance and leave rules' },
  { value: 'payroll_manager', label: 'Payroll Manager', hint: 'Payroll and incentive rules' },
  { value: 'department_head', label: 'Department Head', hint: 'View rules for own department' },
  { value: 'viewer', label: 'Viewer', hint: 'Read-only access' },
];

const PERMISSIONS = ['view', 'create', 'edit', 'delete', 'activate', 'test'];

const DEFAULT_MATRIX: Record<string, string[]> = {
  admin: ['view', 'create', 'edit', 'delete', 'activate', 'test'],
  hr_manager: ['view', 'create', 'edit', 'test'],
  payroll_manager: ['view', 'create', 'edit', 'test'],
  department_head: ['view'],
  viewer: ['view'],
};

export default function SettingsTab({ onChanged }: { onChanged?: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const actor = user?.email || 'user';
  const [section, setSection] = useState<'approvals' | 'permissions' | 'engine' | 'ai'>('approvals');
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approveComments, setApproveComments] = useState<Record<number, string>>({});

  const { data: pending = [] } = useQuery({ queryKey: ['rules-engine', 'approvals', 'pending'], queryFn: () => fetchApprovals({ status: 'pending' }) });
  const { data: rules = [] } = useQuery({ queryKey: ['rules-engine', 'rules', 'all'], queryFn: () => fetchRules() });
  const { data: aiHistory = [] } = useQuery({ queryKey: ['rules-engine', 'ai-history'], queryFn: () => fetchAiHistory(10) });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['rules-engine'] }); onChanged?.(); };

  const decideMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: 'approved' | 'rejected' }) => {
      await decideApproval(id, decision, actor, decision === 'rejected' ? rejectReason : undefined, approveComments[id]);
      // Approving an activation/deactivation request applies it to the rule.
      const req = pending.find((p) => p.id === id);
      if (req && decision === 'approved' && (req.request_type === 'activate' || req.request_type === 'deactivate')) {
        const { toggleRuleActive } = await import('../../api/rulesEngine');
        await toggleRuleActive(req.rule_id, req.request_type === 'activate', actor);
      }
    },
    onSuccess: () => { refresh(); setRejectTarget(null); setRejectReason(''); },
  });

  const firstRuleId = rules[0]?.id;
  const { data: permissions = [] } = useQuery({
    queryKey: ['rules-engine', 'permissions', firstRuleId],
    queryFn: () => fetchRulePermissions(firstRuleId!),
    enabled: section === 'permissions' && !!firstRuleId,
  });

  const permMatrix = (role: string) => permissions.find((p) => p.role === role)?.permissions ?? DEFAULT_MATRIX[role] ?? ['view'];

  const permMutation = useMutation({
    mutationFn: (input: { role: string; permissions: string[] }) => upsertRulePermission({ rule_id: firstRuleId!, role: input.role, permissions: input.permissions, granted_by: actor }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules-engine', 'permissions'] }),
  });

  const togglePermission = (role: string, perm: string) => {
    const current = new Set(permMatrix(role));
    if (current.has(perm)) current.delete(perm); else current.add(perm);
    if (current.size === 0) current.add('view'); // never remove view entirely
    permMutation.mutate({ role, permissions: [...current] });
  };

  const tabs = [
    { id: 'approvals' as const, label: 'Approval Queue', icon: 'pending_actions', count: pending.length },
    { id: 'permissions' as const, label: 'Role Permissions', icon: 'admin_panel_settings', count: null },
    { id: 'engine' as const, label: 'Engine Defaults', icon: 'tune', count: null },
    { id: 'ai' as const, label: 'AI History', icon: 'auto_awesome', count: null },
  ];

  return (
    <div>
      {/* Section switcher */}
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors',
              section === t.id ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            )}
          >
            <span className="material-icons text-base">{t.icon}</span>
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold', section === t.id ? 'bg-white/25' : 'bg-red-100 text-red-600')}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── APPROVALS ── */}
      {section === 'approvals' && (
        <div>
          <p className="text-sm text-slate-500 mb-4 leading-relaxed">
            Maker-checker workflow: rule activation/deactivation requests wait here for approval. Approving an activation applies it instantly.
          </p>
          {pending.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-base text-slate-400">
              <span className="material-icons block text-4xl mb-2 opacity-40">task_alt</span>
              No pending approvals — the queue is clear.
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map((p) => (
                <div key={p.id} className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 sm:p-5">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-0.5 rounded-md bg-amber-500 text-white text-xs font-bold uppercase">{p.request_type}</span>
                        <p className="text-base font-semibold text-slate-800">{p.rules?.name ?? `Rule #${p.rule_id}`}</p>
                      </div>
                      <p className="text-sm text-slate-600 mt-1.5">{p.change_summary ?? 'No summary provided'}</p>
                      <p className="text-xs text-slate-500 mt-1">Requested by {p.requested_by} · {new Date(p.requested_at).toLocaleString()} · level {p.approval_level}/{p.required_approvals}</p>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0 w-full lg:w-56">
                      <input
                        value={approveComments[p.id] ?? ''}
                        onChange={(e) => setApproveComments((c) => ({ ...c, [p.id]: e.target.value }))}
                        placeholder="Comment (optional)"
                        className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white w-full"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => decideMutation.mutate({ id: p.id, decision: 'approved' })}
                          disabled={decideMutation.isPending}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                        >
                          <span className="material-icons text-base">check</span>Approve
                        </button>
                        <button
                          onClick={() => { setRejectTarget(p.id); setRejectReason(''); }}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                        >
                          <span className="material-icons text-base">close</span>Reject
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PERMISSIONS ── */}
      {section === 'permissions' && (
        <div>
          <p className="text-sm text-slate-500 mb-4 leading-relaxed">
            Role-based access control matrix{firstRuleId ? ` (editing defaults for rule #${firstRuleId} — apply per rule as needed)` : ' — create a rule first'}. Every role always keeps View.
          </p>
          <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto [scrollbar-width:thin]">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
                  {PERMISSIONS.map((p) => <th key={p} className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wide text-slate-500 capitalize">{p}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ROLES.map((r) => (
                  <tr key={r.value} className="hover:bg-slate-50/60">
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-800">{r.label}</p>
                      <p className="text-xs text-slate-500">{r.hint}</p>
                    </td>
                    {PERMISSIONS.map((perm) => {
                      const active = permMatrix(r.value).includes(perm);
                      return (
                        <td key={perm} className="px-5 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={active}
                            disabled={!firstRuleId || permMutation.isPending || (perm === 'view')}
                            onChange={() => togglePermission(r.value, perm)}
                            className="h-4 w-4 accent-purple-600 disabled:opacity-50"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ENGINE DEFAULTS ── */}
      {section === 'engine' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h4 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <span className="material-icons text-xl text-purple-500">low_priority</span>Execution Priority Order
            </h4>
            <p className="text-sm text-slate-500 mb-3">Rules run from highest priority (100) to lowest (0). Recommended banding:</p>
            <ol className="space-y-2 text-sm">
              {[
                ['90–100', 'Holiday rules', 'bg-red-50 text-red-700'],
                ['70–89', 'Leave rules', 'bg-purple-50 text-purple-700'],
                ['50–69', 'Attendance rules', 'bg-blue-50 text-blue-700'],
                ['30–49', 'Overtime rules', 'bg-teal-50 text-teal-700'],
                ['0–29', 'Payroll rules', 'bg-emerald-50 text-emerald-700'],
              ].map(([range, label, tone]) => (
                <li key={range} className={clsx('flex items-center gap-3 rounded-lg px-3.5 py-2.5', tone)}>
                  <span className="font-mono font-semibold w-16">{range}</span>{label}
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h4 className="text-base font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <span className="material-icons text-xl text-indigo-500">bolt</span>Engine Behaviour
            </h4>
            <ul className="space-y-3 text-sm text-slate-600">
              <li className="flex items-start gap-2.5"><span className="material-icons text-emerald-500 text-base mt-0.5">check_circle</span>Rules are evaluated from structured definitions stored in the database — never via AI at runtime.</li>
              <li className="flex items-start gap-2.5"><span className="material-icons text-emerald-500 text-base mt-0.5">check_circle</span>Synchronous rules run in priority order; asynchronous rules are queued and never block the caller.</li>
              <li className="flex items-start gap-2.5"><span className="material-icons text-emerald-500 text-base mt-0.5">check_circle</span>Every execution writes an immutable audit log (input, output, matched conditions, actions, duration).</li>
              <li className="flex items-start gap-2.5"><span className="material-icons text-emerald-500 text-base mt-0.5">check_circle</span>Every save creates a version snapshot; rollbacks are themselves new versions — nothing is ever lost.</li>
              <li className="flex items-start gap-2.5"><span className="material-icons text-emerald-500 text-base mt-0.5">check_circle</span>Testing Sandbox runs are dry — production data is never modified by a test.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── AI HISTORY ── */}
      {section === 'ai' && (
        <div>
          <p className="text-sm text-slate-500 mb-4">Recent AI generations (feedback loop for the Gemini rule generator).</p>
          {aiHistory.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-base text-slate-400">
              <span className="material-icons block text-4xl mb-2 opacity-40">auto_awesome</span>
              No AI generations yet. Try the AI Rule Generator in Rule Management.
            </div>
          ) : (
            <div className="space-y-2.5">
              {aiHistory.map((h: any) => (
                <div key={h.id} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">“{h.natural_language_query}”</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {h.ai_provider} · {h.model_used} · {h.tokens_used} tokens · {new Date(h.created_at).toLocaleString()} · by {h.requested_by}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {h.clarifying_questions && <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 font-medium">asked {Array.isArray(h.clarifying_questions) ? h.clarifying_questions.length : '?'} questions</span>}
                    <span className={clsx('text-xs px-2.5 py-1 rounded-full font-medium', h.was_saved ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}>
                      {h.was_saved ? 'saved as rule' : 'not saved'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reject reason modal */}
      {rejectTarget != null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-md">
            <h3 className="text-base font-bold text-slate-800 mb-2.5">Reject request</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Rejection reason (required)"
              className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400/40"
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setRejectTarget(null)} className="flex-1 border border-slate-200 rounded-lg py-2.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={() => decideMutation.mutate({ id: rejectTarget, decision: 'rejected' })}
                disabled={!rejectReason.trim() || decideMutation.isPending}
                className="flex-1 bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-red-700 disabled:opacity-60"
              >
                {decideMutation.isPending ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}