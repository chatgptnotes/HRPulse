/**
 * Rule Testing Sandbox — dry-run rules against sample data without touching
 * production records. The evaluator runs entirely in the browser; "Log results"
 * persists the outcome to rule_execution_logs for the audit trail.
 *
 * Sample data can come from a chosen employee's latest attendance month or be
 * edited by hand in the JSON context box.
 *
 * Visual system: white card, soft icon chip, tinted result stat tiles,
 * clean success result cards with green accents.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { supabase } from '../../lib/supabase';
import { fetchRules, insertExecutionLogs, batchResultToLogEntries } from '../../api/rulesEngine';
import { evaluateRules, type BatchEvalResult } from '../../lib/ruleEvaluator';
import { useAuth } from '../../auth/AuthContext';

interface Props {
  /** When set, the sandbox tests the draft currently open in the builder. */
  draft: {
    id: number | null;
    name: string;
    ruleType?: string;
    priority?: number;
    executionMode?: string;
    conditions: Array<{ key: string; logicalOperator?: 'AND' | 'OR' | null; field: string; operator: string; value: string; valueType: string }>;
    actions: Array<{ key: string; actionType: string; targetField?: string; value?: string; amount?: number; percent?: number; formula?: string; notificationTemplate?: string; notificationRecipients?: string }>;
  } | null;
}

const DEFAULT_CONTEXT = {
  employee: { name: 'Sample Employee', designation: 'Nurse', department: 'General', organisation: 'Hope', status: 'Active', monthlySalary: 30000, shiftName: 'General' },
  attendance: { workingHours: 3.5, status: 'Normal', dayOfWeek: 'Monday', isWeekend: false, isHoliday: false, lateMinutes: 0, earlyMinutes: 0, overtimeHours: 0, lateCount: 2, absentDays: 1, missedSwipeCount: 0, halfDays: 0, presentDays: 20 },
  payroll: { basicSalary: 30000, grossSalary: 33000, netSalary: 33000, deductions: 0, lostPayDays: 0 },
  leave: { balance: 5, takenThisMonth: 1, pendingRequests: 0 },
};

async function fetchEmployeesLight() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('employees').select('id,name,designation,department,organisation,status,monthly_salary,shift_name').order('name').limit(500);
  if (error) throw new Error(error.message);
  return (data || []) as any[];
}

/** Build an evaluation context from an employee's current-month attendance. */
async function buildContextForEmployee(emp: any): Promise<any> {
  if (!supabase) return { ...DEFAULT_CONTEXT, employee: { ...DEFAULT_CONTEXT.employee, name: emp.name } };
  const month = new Date().toISOString().slice(0, 7);
  const { data: records, error } = await supabase
    .from('attendance_records')
    .select('status, work_hours, time_in, record_date, overtime_hours')
    .eq('employee_id', emp.id)
    .gte('record_date', `${month}-01`)
    .lt('record_date', `${month}-32`);
  if (error) throw new Error(error.message);
  const rows = records || [];
  const statusLower = (s: unknown) => String(s || '').toLowerCase();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const latest = rows[rows.length - 1];
  const latestDay = latest ? new Date(`${String(latest.record_date).slice(0, 10)}T00:00:00Z`).getUTCDay() : 1;
  return {
    employee: {
      name: emp.name, designation: emp.designation ?? '', department: emp.department ?? '',
      organisation: emp.organisation ?? '', status: emp.status ?? 'Active',
      monthlySalary: Number(emp.monthly_salary ?? 0), shiftName: emp.shift_name ?? 'General',
    },
    attendance: {
      workingHours: rows.length ? Number(rows.reduce((a: number, r: any) => a + Number(r.work_hours ?? 0), 0) / Math.max(1, rows.length)) : 0,
      status: latest ? String(latest.status) : 'Normal',
      dayOfWeek: days[latestDay],
      isWeekend: latestDay === 0,
      isHoliday: false,
      lateMinutes: 0, earlyMinutes: 0,
      overtimeHours: rows.reduce((a: number, r: any) => a + Number(r.overtime_hours ?? 0), 0),
      lateCount: rows.filter((r: any) => statusLower(r.status).includes('late')).length,
      absentDays: rows.filter((r: any) => statusLower(r.status) === 'absent').length,
      missedSwipeCount: rows.filter((r: any) => statusLower(r.status).includes('missed')).length,
      halfDays: rows.filter((r: any) => statusLower(r.status).includes('half')).length,
      presentDays: rows.filter((r: any) => ['normal', 'present', 'late coming', 'early leaving'].includes(statusLower(r.status))).length,
    },
    payroll: { basicSalary: Number(emp.monthly_salary ?? 0), grossSalary: Number(emp.monthly_salary ?? 0), netSalary: Number(emp.monthly_salary ?? 0), deductions: 0, lostPayDays: 0 },
    leave: { balance: 5, takenThisMonth: 0, pendingRequests: 0 },
  };
}

export default function SandboxPanel({ draft }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [contextText, setContextText] = useState(JSON.stringify(DEFAULT_CONTEXT, null, 2));
  const [result, setResult] = useState<BatchEvalResult | null>(null);
  const [runError, setRunError] = useState('');
  const [logNote, setLogNote] = useState('');
  const [running, setRunning] = useState(false);

  const { data: employees = [] } = useQuery({ queryKey: ['rules-engine', 'employees-light'], queryFn: fetchEmployeesLight, staleTime: 60_000 });

  const testTarget = useMemo(() => {
    if (draft && draft.conditions.length) {
      return [{
        id: draft.id ?? -1,
        name: draft.name || 'Unsaved draft',
        priority: draft.priority ?? 10,
        ruleType: draft.ruleType,
        conditions: draft.conditions.map((c, i) => ({
          logicalOperator: c.logicalOperator ?? null,
          field: c.field,
          operator: c.operator,
          value: c.value,
          valueType: c.valueType,
          displayOrder: i,
        })),
        actions: draft.actions.map((a, i) => ({
          actionType: a.actionType,
          targetField: a.targetField ?? null,
          value: a.value ?? null,
          amount: a.amount ?? null,
          percent: a.percent ?? null,
          formula: a.formula ?? null,
          notificationTemplate: a.notificationTemplate ?? null,
          notificationRecipients: a.notificationRecipients ?? null,
          displayOrder: i,
        })),
      }];
    }
    return null;
  }, [draft]);

  const runTest = async () => {
    setRunError('');
    setLogNote('');
    setRunning(true);
    let context: any;
    try {
      context = JSON.parse(contextText);
    } catch (e) {
      setRunError(e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON context');
      setResult(null);
      setRunning(false);
      return;
    }
    if (testTarget) {
      setResult(evaluateRules(testTarget as any, context));
      setRunning(false);
      return;
    }
    // No draft open: evaluate every ACTIVE rule from the database.
    try {
      const active = await fetchRules({ status: 'active' });
      const evaluable = active.map((r) => ({
        id: r.id, name: r.name, priority: r.priority,
        conditions: (r.rule_conditions || []).map((c: any, i: number) => ({ ...c, displayOrder: i })),
        actions: (r.rule_actions || []).map((a: any, i: number) => ({ ...a, displayOrder: i })),
      }));
      if (!evaluable.length) {
        setRunError('No active rules to test. Open a draft in the builder or activate a rule first.');
        setResult(null);
      } else {
        setResult(evaluateRules(evaluable, context));
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
      setResult(null);
    }
    setRunning(false);
  };

  const logMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error('Run a test first');
      const context = JSON.parse(contextText);
      const entries = batchResultToLogEntries(result, {
        employeeName: context?.employee?.name ?? null,
        context,
        trigger: 'manual',
        executedBy: user?.email || 'user',
        batchId: `sandbox_${Date.now()}`,
      });
      await insertExecutionLogs(entries);
      return entries.length;
    },
    onSuccess: (count) => {
      setLogNote(`${count} execution log${count === 1 ? '' : 's'} written to the audit trail`);
      qc.invalidateQueries({ queryKey: ['rules-engine'] });
    },
    onError: (e) => setLogNote(e instanceof Error ? e.message : String(e)),
  });

  const matched = result?.results.filter((r) => r.matched) ?? [];

  return (
    <div className="rounded-[16px] border border-[#E5E7EB] bg-white p-4 shadow-[0px_2px_10px_rgba(0,0,0,0.05)] sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2.5 text-[16px] font-semibold text-[#111827]">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB]">
            <span className="material-icons text-[17px]">science</span>
          </span>
          Testing Sandbox
        </h3>
        <span className="rounded-full bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-bold text-[#2563EB]">DRY RUN</span>
      </div>

      {/* Employee picker */}
      <div className="mb-2.5 flex flex-col gap-2 sm:flex-row">
        <select
          value=""
          onChange={async (e) => {
            const emp = employees.find((x) => String(x.id) === e.target.value);
            if (!emp) return;
            try {
              const ctx = await buildContextForEmployee(emp);
              setContextText(JSON.stringify(ctx, null, 2));
            } catch (err) {
              setRunError(err instanceof Error ? err.message : String(err));
            }
          }}
          className="h-10 flex-1 cursor-pointer rounded-[10px] border border-[#E5E7EB] bg-white px-3 text-[13px] text-[#111827] transition focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
        >
          <option value="">Load an employee's real data…</option>
          {employees.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>
        <button
          onClick={() => setContextText(JSON.stringify(DEFAULT_CONTEXT, null, 2))}
          className="h-10 shrink-0 rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC]"
          title="Reset to sample data"
        >
          Sample
        </button>
      </div>

      <textarea
        value={contextText}
        onChange={(e) => setContextText(e.target.value)}
        rows={6}
        spellCheck={false}
        className="w-full resize-y rounded-[10px] border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 font-mono text-[12px] text-[#374151] transition focus:border-[#2563EB] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/15"
      />

      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
        <button
          onClick={() => { void runTest(); }}
          disabled={running}
          className="flex flex-1 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] py-2.5 text-[13px] font-semibold text-white shadow-[0px_2px_10px_rgba(37,99,235,0.3)] transition-all duration-200 hover:shadow-[0px_4px_16px_rgba(37,99,235,0.4)] active:scale-[0.99] disabled:opacity-60"
        >
          <span className="material-icons text-[17px]">{running ? 'hourglass_top' : 'play_arrow'}</span>
          {testTarget ? `Test draft (${testTarget.length})` : 'Test all active rules'}
        </button>
        {result && (
          <button
            onClick={() => logMutation.mutate()}
            disabled={logMutation.isPending}
            className="h-10 shrink-0 rounded-[10px] border border-[#E5E7EB] bg-white px-4 text-[13px] font-medium text-[#374151] transition-colors hover:bg-[#F8FAFC] disabled:opacity-50"
            title="Write this run to the execution log"
          >
            {logMutation.isPending ? 'Logging…' : 'Log results'}
          </button>
        )}
      </div>

      {logNote && (
        <p className="mt-2.5 flex items-start gap-2 rounded-[10px] bg-[#DCFCE7] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#16A34A]">
          <span className="material-icons mt-0.5 text-[16px]">check_circle</span>{logNote}
        </p>
      )}
      {runError && (
        <p className="mt-2.5 flex items-start gap-2 rounded-[10px] bg-[#FEE2E2] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#DC2626]">
          <span className="material-icons mt-0.5 text-[16px]">error</span>{runError}
        </p>
      )}

      {/* Results */}
      {result && (
        <div className="mt-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-[12px] border border-[#E5E7EB] bg-[#F8FAFC] p-2.5">
              <p className="text-[20px] font-bold leading-none text-[#111827]">{result.totalRules}</p>
              <p className="mt-1 text-[11px] font-medium text-[#6B7280]">Evaluated</p>
            </div>
            <div className="rounded-[12px] bg-[#DCFCE7] p-2.5">
              <p className="text-[20px] font-bold leading-none text-[#16A34A]">{result.matchedRules}</p>
              <p className="mt-1 text-[11px] font-medium text-[#16A34A]">Matched</p>
            </div>
            <div className="rounded-[12px] bg-[#FEE2E2] p-2.5">
              <p className="text-[20px] font-bold leading-none text-[#EF4444]">{result.failedRules}</p>
              <p className="mt-1 text-[11px] font-medium text-[#EF4444]">Failed</p>
            </div>
            <div className="rounded-[12px] bg-[#EFF6FF] p-2.5">
              <p className="text-[20px] font-bold leading-none text-[#2563EB]">{result.executionTimeMs}<span className="text-[11px]">ms</span></p>
              <p className="mt-1 text-[11px] font-medium text-[#2563EB]">Duration</p>
            </div>
          </div>

          {matched.length === 0 ? (
            <p className="rounded-[10px] bg-[#F8FAFC] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#6B7280]">No rules matched this sample data. Try adjusting the context values above.</p>
          ) : matched.map((r) => (
            <div key={r.ruleId} className="rounded-[12px] border border-[#16A34A]/25 bg-[#F0FDF4] p-3.5">
              <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-[#111827]">
                <span className="material-icons text-[16px] text-[#16A34A]">check_circle</span>
                {r.ruleName}
                <span className="text-[11px] font-normal text-[#9CA3AF]">{r.executionTimeMs}ms</span>
              </p>
              <div className="mt-2 space-y-1.5">
                {r.conditionTraces.map((t, i) => (
                  <p key={i} className={clsx('flex items-center gap-1.5 text-[12.5px] leading-relaxed', t.matched ? 'text-[#166534]' : 'text-[#9CA3AF] line-through')}>
                    <span className="material-icons text-[14px]">{t.matched ? 'check' : 'close'}</span>
                    {t.label}
                    <span className="text-[#9CA3AF]">(actual: {String(t.actualValue)})</span>
                  </p>
                ))}
              </div>
              {r.executedActions.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-[#16A34A]/15 pt-2">
                  {r.executedActions.map((a, i) => (
                    <p key={i} className="flex items-center gap-1.5 text-[12.5px] leading-relaxed text-[#374151]">
                      <span className="material-icons text-[14px] text-[#16A34A]">arrow_forward</span>
                      {a.description}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}