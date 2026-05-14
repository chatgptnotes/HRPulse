export type AttendanceStatus =
  | 'Absent'
  | 'Missed Swipe'
  | 'Late Coming'
  | 'Early Leaving'
  | 'Normal'
  | 'Weekend'
  | 'Holiday'
  | 'Incomplete'
  | string;

export const FLAGGED_STATUSES: AttendanceStatus[] = [
  'Absent',
  'Missed Swipe',
  'Late Coming',
  'Early Leaving',
  'Incomplete',
];

export interface AttendanceRecord {
  id: number;
  uploadId: number;
  employeeId: number;
  recordDate: string;
  status: AttendanceStatus;
  timeIn: string | null;
  timeOut: string | null;
}

export interface AttendanceSummary {
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  absentDays: number;
  missedSwipeDays: number;
  lateComingDays: number;
  earlyLeavingDays: number;
  flaggedTotal: number;
  lopDays: number;
  lopAmount: number;
  hasDraft: boolean;
  draftStatus: 'pending' | 'sent' | 'failed' | null;
  draftId: number | null;
}

export interface AttendanceUpload {
  id: number;
  filename: string;
  periodMonth: string;
  uploadedAt: string;
  rowCount: number;
  status: string;
}
