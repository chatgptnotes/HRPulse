import axios from 'axios';

const configuredApiUrl = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
export const api = axios.create({ baseURL: configuredApiUrl ? `${configuredApiUrl}/api` : '/api' });

export interface EmployeeNameCollisionGroup {
  key: string;
  displayName: string;
  acknowledged: boolean;
  employees: Array<{
    id: number;
    employeeNumber: string;
    name: string;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
  }>;
}

// Attendance
export const uploadAttendance = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post<{
    uploadId: number;
    periodMonth: string;
    rowCount: number;
    employeeCreatedCount: number;
    employeeMatchedCount: number;
    warnings: string[];
    nameCollisionGroups: EmployeeNameCollisionGroup[];
  }>('/attendance/upload', fd);
};
export const inspectAttendance = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/attendance/inspect', fd);
};
export const getUploads = () => api.get('/attendance/uploads');
export const getAttendanceSummary = (uploadId: number) => api.get(`/attendance/summary/${uploadId}`);
export const getAttendanceRecords = (uploadId: number, employeeId: number) => api.get(`/attendance/records/${uploadId}/${employeeId}`);
export const getAttendanceSheet = (uploadId: number) => api.get(`/attendance/sheet/${uploadId}`);
export const deleteUpload = (uploadId: number) => api.delete(`/attendance/uploads/${uploadId}`);

// Emails
export const getEmailDrafts = (uploadId: number) => api.get(`/emails/drafts/${uploadId}`);
export const updateDraft = (draftId: number, data: { subject: string; body: string }) => api.patch(`/emails/drafts/${draftId}`, data);
export const sendEmail = (draftId: number) => api.post(`/emails/send/${draftId}`);
export const sendBulk = (draftIds: number[]) => api.post('/emails/send-bulk', { draftIds });
export const getEmailHistory = (month?: string, employeeId?: number) =>
  api.get('/emails/history', { params: { month, employeeId } });
export const checkPendingReminders = () =>
  api.post<{ created: number; checked: number }>('/emails/remind-pending');

// Salary
export const getSalaryConfigs = (month?: string) => api.get('/salary/configs', { params: { month } });
export const saveSalaryConfig = (data: { employeeId: number; basicSalary: number; effectiveMonth: string }) => api.put('/salary/configs', data);
export const saveSalaryBulk = (configs: Array<{ employeeId: number; basicSalary: number; effectiveMonth: string }>) => api.put('/salary/configs/bulk', { configs });
export const getSalaryDeductions = (uploadId: number) => api.get(`/salary/deductions/${uploadId}`);
export const getSalaryPayments = (month: string) => api.get('/salary/payments', { params: { month } });
export const saveSalaryPayment = (
  employeeId: number,
  data: { periodMonth: string; status: 'pending' | 'paid' | 'on_hold' | 'resigned'; paidAmount?: number; paymentDate?: string; holdReason?: string; notes?: string; markedBy?: string },
) => api.put(`/salary/payments/${employeeId}`, data);

// Payroll (Process Attendance & Calculate Salary)
export const processPayroll = (file: File, uploadedBy = 'admin') => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('uploadedBy', uploadedBy);
  return api.post('/payroll/process', fd);
};
export const getPayrollRun = (uploadId: number) => api.get(`/payroll/runs/${uploadId}`);
export const getPayrollEmployeeDetail = (uploadId: number, employeeId: number) => api.get(`/payroll/employee/${uploadId}/${employeeId}`);
export const getPayrollHistory = () => api.get('/payroll/history');
export const getPayrollFilters = () => api.get('/payroll/filters');
export const getPayrollFinalizationStatus = (periodMonth: string) => api.get(`/payroll/finalization/${periodMonth}/status`);
export const finalizePayroll = (periodMonth: string, overrideReason?: string) =>
  api.post(`/payroll/finalize/${periodMonth}`, { overrideReason: overrideReason || undefined });

// Reusable HIMS connector administration
export const getIntegrationOverview = () => api.get('/integration-admin/overview');
export const updateConnector = (
  connectorKey: string,
  data: { status?: 'disabled' | 'shadow' | 'active' | 'error'; baseUrl?: string | null; pollIntervalSeconds?: number },
) => api.patch(`/integration-admin/connectors/${connectorKey}`, data);
export const getIntegrationEvents = (params?: { direction?: 'inbound' | 'outbound'; status?: string; limit?: number }) =>
  api.get('/integration-admin/events', { params });
export const retryIntegrationEvent = (id: number) => api.post(`/integration-admin/events/${id}/retry`);
export const backfillConnectorEmployees = (connectorKey: string) =>
  api.post(`/integration-admin/connectors/${connectorKey}/backfill-employees`);
export const getConnectorMappings = (connectorKey: string) =>
  api.get(`/integration-admin/connectors/${connectorKey}/mappings`);
export const saveConnectorMapping = (
  connectorKey: string,
  data: { employeeId: number; externalEmployeeId: string; externalUserId?: string | null; externalEmployeeNumber?: string | null },
) => api.put(`/integration-admin/connectors/${connectorKey}/mappings`, data);

// Settings
export const getSettings = () => api.get('/settings');
export const saveSettings = (data: Record<string, string>) => api.put('/settings', data);
export const getTemplates = () => api.get('/settings/templates');
export const saveTemplate = (type: string, data: { subject: string; body: string }) => api.put(`/settings/templates/${type}`, data);
export const testSmtp = () => api.post('/settings/test-smtp');
export const testOllama = () => api.post('/settings/test-ollama');

// Employees
export interface EmployeeMaster {
  employeeNumber?: string;
  name: string;
  email?: string;
  mobile?: string;
  department?: string;
  designation?: string;
  shift?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  monthlySalary?: number;
  status?: 'Active' | 'Inactive';
  paidLeavesEligible?: boolean;
  overtimeEligible?: boolean;
}
export const getEmployees = () => api.get('/employees');
export const getEmployee = (id: number) => api.get(`/employees/${id}`);
export const getEmployeeNameCollisions = () => api.get<EmployeeNameCollisionGroup[]>('/employees/name-collisions');
export const acknowledgeEmployeeNameCollision = (group: EmployeeNameCollisionGroup) =>
  api.post<EmployeeNameCollisionGroup>('/employees/name-collisions/acknowledge', {
    key: group.key,
    employeeIds: group.employees.map(employee => employee.id),
  });
export const getEmployeeDocuments = (id: number) => api.get(`/employees/${id}/documents`);
export const createEmployee = (data: EmployeeMaster) => api.post('/employees', data);
export const updateEmployee = (id: number, data: Partial<EmployeeMaster> & { email?: string }) => api.patch(`/employees/${id}`, data);
export const deleteEmployee = (id: number) => api.delete(`/employees/${id}`);
export type EmployeeNotificationSeverity = 'info' | 'success' | 'warning' | 'critical';
export const sendEmployeeNotification = (
  employeeId: number,
  data: { title: string; body: string; type?: string; severity?: EmployeeNotificationSeverity; sentBy?: string },
) => api.post('/notifications/send', { employeeId, ...data });

// Leave administration
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export interface LeaveBalance {
  id: number;
  employeeId: number;
  leaveType: string;
  openingBalance: number;
  accrued: number;
  used: number;
  pending: number;
  available: number;
  periodYear: number;
}
export interface LeaveRequest {
  id: number;
  employeeId: number;
  employee: {
    id: number;
    employeeNumber: string;
    name: string;
    email: string;
    department: string;
    designation: string;
    paidLeavesEligible: boolean;
  } | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  source: string;
  approverNotes: string;
  decidedBy: string;
  decidedAt: string | null;
  requestedAt: string;
  balance: LeaveBalance | null;
}
export const getLeaveRequests = (params?: { status?: string; search?: string; employeeId?: number }) =>
  api.get<LeaveRequest[]>('/leaves', { params });
export const getEmployeeLeaves = (employeeId: number) =>
  api.get<{ requests: LeaveRequest[]; balances: LeaveBalance[] }>(`/leaves/employee/${employeeId}`);
export const saveLeaveBalance = (employeeId: number, data: { leaveType: string; periodYear: number; available: number }) =>
  api.put<LeaveBalance>(`/leaves/balances/${employeeId}`, data);
export const decideLeaveRequest = (id: number, data: { decision: 'approved' | 'rejected'; approverNotes?: string; decidedBy?: string }) =>
  api.patch<{ request: LeaveRequest; balance: LeaveBalance | null }>(`/leaves/${id}/decision`, data);

// SOPs
export const getSops = (params?: { category?: string; search?: string }) => api.get('/sops', { params });
export const getSopCategories = () => api.get('/sops/categories');
export const getSop = (id: number) => api.get(`/sops/${id}`);
export const createSop = (data: { title: string; category: string; content: string; tags?: string[] }) => api.post('/sops', data);
export const updateSop = (id: number, data: { title: string; category: string; content: string; tags?: string[] }) => api.put(`/sops/${id}`, data);
export const deleteSop = (id: number) => api.delete(`/sops/${id}`);

// Rules
export const getRules = () => api.get('/rules');
export const createRule = (data: { name: string; description: string; ruleType: string; conditions: object; actions: object; priority?: number }) => api.post('/rules', data);
export const updateRule = (id: number, data: object) => api.put(`/rules/${id}`, data);
export const deleteRule = (id: number) => api.delete(`/rules/${id}`);
export const toggleRule = (id: number) => api.patch(`/rules/${id}/toggle`);
export const generateRule = (prompt: string) => api.post('/rules/generate', { prompt });
export const evaluateRules = (uploadId: number, autoCreateDrafts = true) =>
  api.post<{ matches: any[]; draftsCreated: number; employeesEvaluated: number }>(`/rules/evaluate/${uploadId}`, { autoCreateDrafts });

// Analytics
export const getAnalyticsOverview = () => api.get('/analytics/overview');
export const getAnalyticsTrends = (uploadId: number) => api.get(`/analytics/trends/${uploadId}`);
export const getMonthlyComparison = () => api.get('/analytics/monthly-comparison');

// Salary Sheet Auto-Fill
export const fillSalarySheet = (salarySheet: File, attendanceFile: File, sheetName: string, workingDays: number) => {
  const fd = new FormData();
  fd.append('salarySheet', salarySheet);
  fd.append('attendanceFile', attendanceFile);
  fd.append('sheetName', sheetName);
  fd.append('workingDays', String(workingDays));
  return api.post('/salary-fill', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

// AI
export const askAi = (question: string, uploadId?: number) => api.post('/ai/ask', { question, uploadId });
export const analyzeUpload = (uploadId: number) => api.post(`/ai/analyze/${uploadId}`);
export const getAiInsights = (uploadId: number) => api.get(`/ai/insights/${uploadId}`);
export const predictRisk = () => api.post('/ai/predict');
export const generateReport = (uploadId: number) => api.post(`/ai/generate-report/${uploadId}`);
