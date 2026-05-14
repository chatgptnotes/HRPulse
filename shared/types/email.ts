export type EmailStatus = 'pending' | 'sent' | 'failed';
export type TemplateType = 'initial' | 'reminder' | 'escalation';

export interface EmailDraft {
  id: number;
  uploadId: number;
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  templateType: TemplateType;
  subject: string;
  body: string;
  isEdited: boolean;
  status: EmailStatus;
  sentAt: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface EmailTemplate {
  id: number;
  type: TemplateType;
  subject: string;
  body: string;
}

export interface EmailHistoryEntry {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeEmail: string;
  uploadId: number | null;
  subject: string;
  sentAt: string;
  status: EmailStatus;
  errorMessage: string | null;
}

export interface GenerateProgress {
  total: number;
  completed: number;
  currentEmployee: string;
}
