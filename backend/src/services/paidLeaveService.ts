import { supabase } from '../db/supabase';
import { isPayrollDay, type RawDay } from './payrollService';

export interface ApprovedLeaveDay {
  date: string;
  fraction: number;
  paid: boolean;
}

function monthEnd(periodMonth: string) {
  const [year, month] = periodMonth.split('-').map(Number);
  return `${periodMonth}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
}

function dayFraction(value: unknown) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export async function loadApprovedLeaveDays(
  employeeIds: number[],
  periodMonth: string,
): Promise<Record<number, ApprovedLeaveDay[]>> {
  if (!employeeIds.length) return {};
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) throw new Error(`Invalid payroll month: ${periodMonth}`);

  const { data, error } = await supabase
    .from('leave_requests')
    .select('employee_id, start_date, end_date, start_day_part, end_day_part, leave_request_days(leave_date, day_fraction, is_paid)')
    .in('employee_id', employeeIds)
    .eq('status', 'approved')
    .lte('start_date', monthEnd(periodMonth))
    .gte('end_date', `${periodMonth}-01`);
  if (error) throw new Error(`Unable to load approved leave: ${error.message}`);

  const result: Record<number, ApprovedLeaveDay[]> = {};
  const add = (employeeId: number, leaveDay: ApprovedLeaveDay) => {
    if (!leaveDay.date.startsWith(periodMonth) || !isPayrollDay(leaveDay.date) || leaveDay.fraction <= 0) return;
    if (!result[employeeId]) result[employeeId] = [];
    result[employeeId].push(leaveDay);
  };

  for (const leave of (data || []) as any[]) {
    const explicit = Array.isArray(leave.leave_request_days) ? leave.leave_request_days : [];
    if (explicit.length) {
      for (const day of explicit) {
        add(leave.employee_id, {
          date: String(day.leave_date).slice(0, 10),
          fraction: dayFraction(day.day_fraction || 1),
          paid: day.is_paid !== false,
        });
      }
      continue;
    }

    const cursor = new Date(`${leave.start_date}T00:00:00Z`);
    const end = new Date(`${leave.end_date}T00:00:00Z`);
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      let fraction = 1;
      if (date === leave.start_date && leave.start_day_part && leave.start_day_part !== 'full') fraction = 0.5;
      if (date === leave.end_date && leave.end_day_part && leave.end_day_part !== 'full') fraction = 0.5;
      add(leave.employee_id, { date, fraction, paid: true });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  for (const employeeId of Object.keys(result)) {
    result[Number(employeeId)].sort((a, b) => a.date.localeCompare(b.date));
  }
  return result;
}

export function overlayApprovedLeave(
  days: RawDay[],
  leaveDays: ApprovedLeaveDay[],
  department?: string | null,
): RawDay[] {
  if (!leaveDays.length) return days;
  const byDate = new Map<string, RawDay>(days.map(day => [String(day.recordDate).slice(0, 10), day]));
  for (const leave of leaveDays) {
    if (!isPayrollDay(leave.date)) continue;
    const current = byDate.get(leave.date) || {
      recordDate: leave.date,
      status: 'Not Attempted',
      timeIn: null,
      timeOut: null,
    };
    const isHoliday = String(current.status || '').trim().toLowerCase() === 'holiday';
    const date = new Date(`${leave.date}T00:00:00Z`);
    const isItWeeklyOff = String(department || '').trim().toLowerCase() === 'it' && date.getUTCDay() === 0;
    if (isHoliday || isItWeeklyOff) continue;

    const existingFraction = dayFraction(current.approvedLeaveFraction);
    const combinedFraction = Math.min(1, existingFraction + dayFraction(leave.fraction));
    byDate.set(leave.date, {
      ...current,
      approvedLeaveFraction: combinedFraction,
      approvedLeavePaid: current.approvedLeavePaid === false ? false : leave.paid,
    });
  }
  return [...byDate.values()].sort((a, b) => a.recordDate.localeCompare(b.recordDate));
}
