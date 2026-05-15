import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

// Attendance
export const uploadAttendance = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post<{ uploadId: number; periodMonth: string; rowCount: number; warnings: string[] }>('/attendance/upload', fd);
};
export const getUploads = () => api.get('/attendance/uploads');
export const getAttendanceSummary = (uploadId: number) => api.get(`/attendance/summary/${uploadId}`);
export const getAttendanceRecords = (uploadId: number, employeeId: number) => api.get(`/attendance/records/${uploadId}/${employeeId}`);
export const deleteUpload = (uploadId: number) => api.delete(`/attendance/uploads/${uploadId}`);

// Emails
export const getEmailDrafts = (uploadId: number) => api.get(`/emails/drafts/${uploadId}`);
export const updateDraft = (draftId: number, data: { subject: string; body: string }) => api.patch(`/emails/drafts/${draftId}`, data);
export const sendEmail = (draftId: number) => api.post(`/emails/send/${draftId}`);
export const sendBulk = (draftIds: number[]) => api.post('/emails/send-bulk', { draftIds });
export const getEmailHistory = (month?: string, employeeId?: number) =>
  api.get('/emails/history', { params: { month, employeeId } });

// Salary
export const getSalaryConfigs = (month?: string) => api.get('/salary/configs', { params: { month } });
export const saveSalaryConfig = (data: { employeeId: number; basicSalary: number; effectiveMonth: string }) => api.put('/salary/configs', data);
export const saveSalaryBulk = (configs: Array<{ employeeId: number; basicSalary: number; effectiveMonth: string }>) => api.put('/salary/configs/bulk', { configs });
export const getSalaryDeductions = (uploadId: number) => api.get(`/salary/deductions/${uploadId}`);

// Settings
export const getSettings = () => api.get('/settings');
export const saveSettings = (data: Record<string, string>) => api.put('/settings', data);
export const getTemplates = () => api.get('/settings/templates');
export const saveTemplate = (type: string, data: { subject: string; body: string }) => api.put(`/settings/templates/${type}`, data);
export const testSmtp = () => api.post('/settings/test-smtp');
export const testOllama = () => api.post('/settings/test-ollama');

// Employees
export const getEmployees = () => api.get('/employees');
export const getEmployee = (id: number) => api.get(`/employees/${id}`);
export const updateEmployee = (id: number, data: { name?: string; email?: string; department?: string }) => api.patch(`/employees/${id}`, data);
export const uploadEmployeePhoto = (id: number, file: File) => {
  const fd = new FormData();
  fd.append('photo', file);
  return api.post(`/employees/${id}/photo`, fd);
};

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

// Analytics
export const getAnalyticsOverview = () => api.get('/analytics/overview');
export const getAnalyticsTrends = (uploadId: number) => api.get(`/analytics/trends/${uploadId}`);
export const getMonthlyComparison = () => api.get('/analytics/monthly-comparison');

// AI
export const askAi = (question: string, uploadId?: number) => api.post('/ai/ask', { question, uploadId });
export const analyzeUpload = (uploadId: number) => api.post(`/ai/analyze/${uploadId}`);
export const getAiInsights = (uploadId: number) => api.get(`/ai/insights/${uploadId}`);
export const predictRisk = () => api.post('/ai/predict');
export const generateReport = (uploadId: number) => api.post(`/ai/generate-report/${uploadId}`);
