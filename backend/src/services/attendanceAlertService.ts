import { getSettings, supabase } from '../db/supabase';
import { upsertHrNotification } from './hrNotificationService';
import { isLateArrival as isLateByPolicy, LATE_GRACE_MINUTES } from './latePolicy';
import { isItDepartment, isSunday, qualifyingOvertimeHours } from './payrollService';

type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'late'
  | 'early'
  | 'missing_punch'
  | 'missing_punch_in'
  | 'missing_punch_out'
  | 'holiday'
  | 'weekly_off'
  | 'leave';

type AttendanceRecord = {
  employee_id?: number;
  record_date?: string;
  status?: string | null;
  time_in?: string | null;
  time_out?: string | null;
};

type AlertEmployee = {
  id: number;
  name?: string | null;
  email?: string | null;
  department?: string | null;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
  overtime_eligible?: boolean | null;
};

type AttendanceNotification = {
  key: string;
  type: string;
  priority: number;
  title: string;
  body: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  relatedDate?: string | null;
  metadata: Record<string, unknown>;
};

const PAGE_SIZE = 1000;

function normalizeAttendanceStatus(status: string | null | undefined): AttendanceStatus {
  const s = String(status || '').toLowerCase();
  if (s.includes('absent')) return 'absent';
  if (s.includes('half')) return 'half_day';
  if (s.includes('late')) return 'late';
  if (s.includes('early')) return 'early';
  if (s.includes('missed') || s.includes('missing') || s.includes('incomplete')) return 'missing_punch';
  if (s.includes('holiday')) return 'holiday';
  if (s.includes('weekend') || s.includes('weekly')) return 'weekly_off';
  if (s.includes('leave')) return 'leave';
  return 'present';
}

function timeToMinutes(value: string | null | undefined) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function workingHours(record: AttendanceRecord) {
  const start = timeToMinutes(record.time_in);
  const end = timeToMinutes(record.time_out);
  if (start == null || end == null || end < start) return 0;
  return Math.round(((end - start) / 60) * 10) / 10;
}

function recordDate(record: AttendanceRecord) {
  return String(record.record_date || '').slice(0, 10);
}

function formatDisplayDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatFullDisplayDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateList(dates: string[]) {
  const uniqueDates = [...new Set(dates.filter(Boolean))];
  if (!uniqueDates.length) return 'the selected dates';
  return uniqueDates.map(formatDisplayDate).join(', ');
}

function todayKeyDate() {
  return new Date().toISOString().slice(0, 10);
}

function isLateArrival(record: AttendanceRecord, employee: AlertEmployee, graceMinutes: number) {
  return isLateByPolicy(record.status, record.time_in, employee.shift_start_time, graceMinutes);
}

function isEarlyDeparture(record: AttendanceRecord, employee: AlertEmployee, graceMinutes: number) {
  const status = normalizeAttendanceStatus(record.status);
  if (status === 'early') return true;
  if (['absent', 'holiday', 'weekly_off', 'leave'].includes(status)) return false;
  const punchOut = timeToMinutes(record.time_out);
  const shiftEnd = timeToMinutes(employee.shift_end_time);
  if (punchOut == null || shiftEnd == null) return false;
  return punchOut < shiftEnd - Math.max(0, graceMinutes);
}

function attendancePercentage(summary: { present: number; halfDay: number; workingDays: number }) {
  if (summary.workingDays <= 0) return 0;
  return Math.round(((summary.present + summary.halfDay * 0.5) / summary.workingDays) * 1000) / 10;
}

function consecutiveDetails(records: AttendanceRecord[], predicate: (record: AttendanceRecord) => boolean) {
  let current: string[] = [];
  let longest: string[] = [];
  for (const record of records) {
    const status = normalizeAttendanceStatus(record.status);
    if (predicate(record)) {
      const date = recordDate(record);
      current = date ? [...current, date] : [...current];
      if (current.length > longest.length) longest = current;
    } else if (!['holiday', 'weekly_off', 'leave'].includes(status)) {
      current = [];
    }
  }
  return { count: longest.length, dates: longest };
}

function summarizeAttendance(
  records: AttendanceRecord[],
  employee: AlertEmployee,
  workingDaysSetting: number,
  standardHours: number,
  overtimeThresholdHours: number,
  lateGraceMinutes: number,
  earlyGraceMinutes: number,
) {
  const summary = {
    present: 0,
    absent: 0,
    halfDay: 0,
    lateCount: 0,
    earlyCount: 0,
    missingPunches: 0,
    missingPunchIn: 0,
    missingPunchOut: 0,
    insufficientHours: 0,
    overtimeDays: 0,
    holidayWork: 0,
    weeklyOffWork: 0,
    workingDays: workingDaysSetting,
    attendancePercentage: 0,
    dates: {
      absent: [] as string[],
      halfDay: [] as string[],
      late: [] as string[],
      early: [] as string[],
      missingPunch: [] as string[],
      missingPunchIn: [] as string[],
      missingPunchOut: [] as string[],
      insufficientHours: [] as string[],
      overtime: [] as string[],
      holidayWork: [] as string[],
      weeklyOffWork: [] as string[],
    },
  };

  for (const record of records) {
    const status = normalizeAttendanceStatus(record.status);
    const hasIn = !!record.time_in;
    const hasOut = !!record.time_out;
    const hours = workingHours(record);

    const date = recordDate(record);

    if (status === 'absent') {
      summary.absent++;
      if (date) summary.dates.absent.push(date);
    } else if (status === 'half_day') {
      summary.halfDay++;
      if (date) summary.dates.halfDay.push(date);
    }
    else if (!['holiday', 'weekly_off'].includes(status)) summary.present++;

    if (isLateArrival(record, employee, lateGraceMinutes)) {
      summary.lateCount++;
      if (date) summary.dates.late.push(date);
    }
    if (isEarlyDeparture(record, employee, earlyGraceMinutes)) {
      summary.earlyCount++;
      if (date) summary.dates.early.push(date);
    }
    if (status === 'missing_punch') {
      summary.missingPunches++;
      if (date) summary.dates.missingPunch.push(date);
    }
    if (!hasIn && hasOut) {
      summary.missingPunchIn++;
      if (date) summary.dates.missingPunchIn.push(date);
    }
    if (hasIn && !hasOut) {
      summary.missingPunchOut++;
      if (date) summary.dates.missingPunchOut.push(date);
    }
    if (hasIn !== hasOut && status !== 'missing_punch') {
      summary.missingPunches++;
      if (date) summary.dates.missingPunch.push(date);
    }
    if (hasIn && hasOut && hours > 0 && hours < standardHours) {
      summary.insufficientHours++;
      if (date) summary.dates.insufficientHours.push(date);
    }
    const overtimeStatus = isItDepartment(employee.department) && isSunday(date) ? 'Weekly Off' : String(record.status || '');
    if (qualifyingOvertimeHours(employee.overtime_eligible === true, overtimeStatus, record.time_in, record.time_out, employee.shift_end_time, overtimeThresholdHours) > 0) {
      summary.overtimeDays++;
      if (date) summary.dates.overtime.push(date);
    }
    if (status === 'holiday' && (hasIn || hasOut)) {
      summary.holidayWork++;
      if (date) summary.dates.holidayWork.push(date);
    }
    if (status === 'weekly_off' && (hasIn || hasOut)) {
      summary.weeklyOffWork++;
      if (date) summary.dates.weeklyOffWork.push(date);
    }
  }

  summary.attendancePercentage = attendancePercentage(summary);
  return summary;
}

function buildPersonalMessage(employee: AlertEmployee, body: string) {
  const firstName = String(employee.name || '').trim().split(/\s+/)[0];
  return firstName ? `${firstName}, ${body}` : body;
}

function addDailyNotification(
  notifications: AttendanceNotification[],
  employee: AlertEmployee,
  record: AttendanceRecord,
  type: string,
  title: string,
  body: string,
  severity: AttendanceNotification['severity'],
  priority: number,
  extra: Record<string, unknown> = {},
) {
  const date = recordDate(record);
  if (!date) return;
  notifications.push({
    key: `attendance:${date}:${type}`,
    type,
    priority,
    title,
    body: buildPersonalMessage(employee, body),
    severity,
    relatedDate: date,
    metadata: {
      date,
      displayDate: formatFullDisplayDate(date),
      month: date.slice(0, 7),
      priority,
      punchIn: record.time_in || null,
      punchOut: record.time_out || null,
      status: record.status || null,
      ...extra,
    },
  });
}

export async function ensureAttendanceAlertNotifications(
  employee: AlertEmployee,
  month: string,
  records: AttendanceRecord[],
  uploadedDates?: Set<string>,
) {
  const settings: Record<string, string> = await getSettings().catch(() => ({} as Record<string, string>));
  const workingDays = Number(settings['working_days'] || 30);
  const standardHours = Number(settings['standard_working_hours'] || 8);
  const overtimeThresholdHours = Number(settings['ot_threshold_hours'] || 2);
  const lateGraceMinutes = Number(settings['late_grace_minutes'] || settings['ess_late_grace_minutes'] || LATE_GRACE_MINUTES);
  const earlyGraceMinutes = Number(settings['early_grace_minutes'] || settings['ess_early_grace_minutes'] || 0);
  const lowAttendanceThreshold = Number(settings['ess_low_attendance_threshold'] || settings['low_attendance_threshold'] || 75);
  const lowAttendanceDaysThreshold = Number(settings['ess_low_attendance_days_threshold'] || settings['low_attendance_days_threshold'] || 5);

  const sortedRecords = [...records].sort((a, b) => String(a.record_date || '').localeCompare(String(b.record_date || '')));
  const summary = summarizeAttendance(
    sortedRecords,
    employee,
    Number.isFinite(workingDays) && workingDays > 0 ? workingDays : 30,
    Number.isFinite(standardHours) && standardHours > 0 ? standardHours : 8,
    Number.isFinite(overtimeThresholdHours) && overtimeThresholdHours >= 0 ? overtimeThresholdHours : 2,
    Number.isFinite(lateGraceMinutes) ? lateGraceMinutes : LATE_GRACE_MINUTES,
    Number.isFinite(earlyGraceMinutes) ? earlyGraceMinutes : 0,
  );
  const notifications: AttendanceNotification[] = [];

  const dailyRecords = sortedRecords.filter((record) => {
    const date = recordDate(record);
    return date && (!uploadedDates || uploadedDates.has(date));
  });

  for (const record of dailyRecords) {
    const date = recordDate(record);
    const displayDate = formatFullDisplayDate(date);
    const status = normalizeAttendanceStatus(record.status);
    const hasIn = !!record.time_in;
    const hasOut = !!record.time_out;
    const hours = workingHours(record);

    if (isLateArrival(record, employee, Number.isFinite(lateGraceMinutes) ? lateGraceMinutes : LATE_GRACE_MINUTES)) {
      addDailyNotification(
        notifications,
        employee,
        record,
        'late_arrival_alert',
        'Late arrival alert',
        `you were late on ${displayDate}. Punch-in: ${record.time_in || '-'}, shift start: ${employee.shift_start_time || '09:00'}, grace: ${lateGraceMinutes} minutes.`,
        'warning',
        40,
        { lateGraceMinutes },
      );
    }

    // Missing punches are summarized below only when the monthly count is more
    // than 2. Individual missing-punch days still appear in attendance records.

    if (status === 'absent') {
      addDailyNotification(
        notifications,
        employee,
        record,
        'absent_alert',
        'Absent alert',
        `your attendance is marked absent on ${displayDate}. Please contact HR if correction or leave regularization is required.`,
        'critical',
        20,
      );
    }

    if (status === 'half_day') {
      addDailyNotification(
        notifications,
        employee,
        record,
        'half_day_alert',
        'Half day alert',
        `your attendance is marked Half Day on ${displayDate}. Working hours: ${hours || 0}.`,
        'warning',
        45,
        { workingHours: hours },
      );
    }

    if (isEarlyDeparture(record, employee, Number.isFinite(earlyGraceMinutes) ? earlyGraceMinutes : 0)) {
      addDailyNotification(
        notifications,
        employee,
        record,
        'early_departure_alert',
        'Early departure alert',
        `you left early on ${displayDate}. Punch-out: ${record.time_out || '-'}, shift end: ${employee.shift_end_time || '-'}.`,
        'warning',
        50,
        { earlyGraceMinutes },
      );
    }

    if (hasIn && hasOut && hours > 0 && hours < standardHours) {
      addDailyNotification(
        notifications,
        employee,
        record,
        'insufficient_working_hours',
        'Insufficient working hours',
        `your working hours were below policy on ${displayDate}. Worked: ${hours} hours, required: ${standardHours} hours.`,
        'warning',
        55,
        { workingHours: hours, standardHours },
      );
    }

    const overtimeStatus = isItDepartment(employee.department) && isSunday(date) ? 'Weekly Off' : String(record.status || '');
    const overtimeHours = qualifyingOvertimeHours(
      employee.overtime_eligible === true,
      overtimeStatus,
      record.time_in,
      record.time_out,
      employee.shift_end_time,
      Number.isFinite(overtimeThresholdHours) ? overtimeThresholdHours : 2,
    );
    if (overtimeHours > 0) {
      addDailyNotification(
        notifications,
        employee,
        record,
        'overtime_alert',
        'Overtime alert',
        `your attendance shows qualifying overtime on ${displayDate}. You stayed ${Math.round(overtimeHours * 10) / 10} hours beyond shift end and earned a half-day salary allowance.`,
        'warning',
        80,
        { workingHours: hours, standardHours },
      );
    }

    if (status === 'holiday' && (hasIn || hasOut)) {
      addDailyNotification(
        notifications,
        employee,
        record,
        'holiday_work_alert',
        'Holiday work alert',
        `your attendance shows work on a holiday on ${displayDate}. HR will review applicable policy benefits.`,
        'warning',
        75,
      );
    }

    if (status === 'weekly_off' && (hasIn || hasOut)) {
      addDailyNotification(
        notifications,
        employee,
        record,
        'weekly_off_attendance',
        'Weekly off attendance',
        `you worked on a weekly off on ${displayDate}. HR will review this according to company policy.`,
        'warning',
        70,
      );
    }
  }

  const lateStreakDetails = consecutiveDetails(sortedRecords, record =>
    isLateArrival(record, employee, Number.isFinite(lateGraceMinutes) ? lateGraceMinutes : LATE_GRACE_MINUTES)
  );

  if (summary.missingPunches > 2) {
    notifications.push({
      key: `attendance:${month}:multiple_missing_punches`,
      type: 'multiple_missing_punches',
      priority: 20,
      title: 'Multiple missing punches',
      body: buildPersonalMessage(employee, `you have ${summary.missingPunches} missing punch records on ${formatDateList(summary.dates.missingPunch)}. Please regularize them with HR. No salary deduction has been applied for missing punches.`),
      severity: 'warning',
      relatedDate: summary.dates.missingPunch[0] || null,
      metadata: { month, missingPunches: summary.missingPunches, dates: summary.dates.missingPunch, displayDates: formatDateList(summary.dates.missingPunch), priority: 20 },
    });
  }

  const lateStreak = lateStreakDetails.count;
  if (lateStreak >= 3) {
    notifications.push({
      key: `attendance:${month}:three_consecutive_late`,
      type: 'three_consecutive_late',
      priority: 10,
      title: 'Three consecutive late arrivals',
      body: buildPersonalMessage(employee, `you reported late for ${lateStreak} consecutive working days on ${formatDateList(lateStreakDetails.dates)}. Please ensure timely attendance to avoid disciplinary action or salary deductions.`),
      severity: 'critical',
      relatedDate: lateStreakDetails.dates[0] || null,
      metadata: { month, lateStreak, dates: lateStreakDetails.dates, displayDates: formatDateList(lateStreakDetails.dates), priority: 10 },
    });
  }

  const absentStreakDetails = consecutiveDetails(sortedRecords, record => normalizeAttendanceStatus(record.status) === 'absent');
  const absentStreak = absentStreakDetails.count;
  if (absentStreak >= 3) {
    notifications.push({
      key: `attendance:${month}:three_consecutive_absences`,
      type: 'three_consecutive_absences',
      priority: 10,
      title: 'Three consecutive absences',
      body: buildPersonalMessage(employee, `you have ${absentStreak} consecutive absence records on ${formatDateList(absentStreakDetails.dates)}. Please contact HR immediately for leave or attendance regularization.`),
      severity: 'critical',
      relatedDate: absentStreakDetails.dates[0] || null,
      metadata: { month, absentStreak, dates: absentStreakDetails.dates, displayDates: formatDateList(absentStreakDetails.dates), priority: 10 },
    });
  }

  const lowAttendanceIssueDays = summary.absent + summary.halfDay;
  if (
    lowAttendanceIssueDays >= lowAttendanceDaysThreshold ||
    (summary.attendancePercentage > 0 && summary.attendancePercentage < lowAttendanceThreshold)
  ) {
    const reminderDate = todayKeyDate();
    const issueDates = [...summary.dates.absent, ...summary.dates.halfDay].sort();
    notifications.push({
      key: `attendance:${month}:${reminderDate}:low_attendance_reminder`,
      type: 'low_attendance_reminder',
      priority: 15,
      title: 'Attendance reminder',
      body: buildPersonalMessage(employee, `your attendance needs attention for ${month}. Issue days: ${lowAttendanceIssueDays}${issueDates.length ? ` (${formatDateList(issueDates)})` : ''}. Attendance: ${summary.attendancePercentage}%. Please regularize leave or contact HR.`),
      severity: 'critical',
      metadata: { month, reminderDate, issueDays: lowAttendanceIssueDays, dates: issueDates, displayDates: formatDateList(issueDates), attendancePercentage: summary.attendancePercentage, threshold: lowAttendanceThreshold, daysThreshold: lowAttendanceDaysThreshold, priority: 15 },
    });
  }

  for (const item of notifications) {
    await upsertHrNotification({
      employee_id: employee.id,
      employee_email: employee.email || null,
      notification_key: item.key,
      type: item.type,
      title: item.title,
      body: item.body,
      severity: item.severity,
      source: 'hrpulse_attendance_ai',
      metadata: {
        ...item.metadata,
        relatedDate: item.relatedDate || null,
        priority: item.priority,
        source: 'HRPulse',
        analysisEngine: 'attendance_ai_v1',
      },
    });
  }

  return { notifications, summary };
}

async function fetchUploadEmployeeDates(uploadId: number) {
  const rows: Array<{ employee_id: number; record_date: string }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('employee_id, record_date')
      .eq('upload_id', uploadId)
      .order('employee_id', { ascending: true })
      .order('record_date', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as Array<{ employee_id: number; record_date: string }>));
    if (!data || data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function ensureAttendanceAlertNotificationsForUpload(uploadId: number, month: string) {
  const uploadRecords = await fetchUploadEmployeeDates(uploadId);

  const employeeIds = [...new Set(uploadRecords.map((record: any) => record.employee_id).filter(Boolean))];
  if (!employeeIds.length) return { employeesChecked: 0, notificationsCreated: 0 };

  const [year, mon] = month.split('-').map(Number);
  const start = `${month}-01`;
  const next = mon === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(mon + 1).padStart(2, '0')}-01`;

  let [{ data: employees, error: employeesError }, { data: records, error: recordsError }] = await Promise.all([
    supabase.from('employees').select('id, name, email, department, shift_start_time, shift_end_time, overtime_eligible').in('id', employeeIds),
    supabase
      .from('attendance_records')
      .select('employee_id, record_date, status, time_in, time_out')
      .in('employee_id', employeeIds)
      .gte('record_date', start)
      .lt('record_date', next)
      .order('record_date', { ascending: true }),
  ]);
  if (employeesError && /overtime_eligible|does not exist|schema cache/i.test(employeesError.message)) {
    const retry = await supabase.from('employees').select('id, name, email, department, shift_start_time, shift_end_time').in('id', employeeIds);
    employees = retry.data as any;
    employeesError = retry.error;
  }
  if (employeesError) throw new Error(employeesError.message);
  if (recordsError) throw new Error(recordsError.message);

  const byEmployee = new Map<number, AttendanceRecord[]>();
  for (const record of records || []) {
    const employeeId = Number((record as any).employee_id);
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, []);
    byEmployee.get(employeeId)!.push(record as AttendanceRecord);
  }

  const uploadedDatesByEmployee = new Map<number, Set<string>>();
  for (const record of uploadRecords) {
    const employeeId = Number((record as any).employee_id);
    const date = String((record as any).record_date || '').slice(0, 10);
    if (!employeeId || !date) continue;
    if (!uploadedDatesByEmployee.has(employeeId)) uploadedDatesByEmployee.set(employeeId, new Set<string>());
    uploadedDatesByEmployee.get(employeeId)!.add(date);
  }

  let notificationsCreated = 0;
  for (const employee of employees || []) {
    const employeeId = Number((employee as any).id);
    const result = await ensureAttendanceAlertNotifications(
      employee as AlertEmployee,
      month,
      byEmployee.get(employeeId) || [],
      uploadedDatesByEmployee.get(employeeId),
    );
    notificationsCreated += result.notifications.length;
  }

  return { employeesChecked: employeeIds.length, notificationsCreated };
}
