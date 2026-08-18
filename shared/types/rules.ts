/**
 * Rules Engine Type Definitions
 *
 * This file contains all TypeScript interfaces and types for the enterprise
 * Rules Engine system, including rules, conditions, actions, categories,
 * approvals, versions, permissions, execution logs, schedules, and AI generation.
 */

// =============================================================================
// CORE RULE TYPES
// =============================================================================

export interface Rule {
  id: number;
  name: string;
  description?: string;
  categoryId: number;
  ruleType: RuleType;
  isActive: boolean;
  priority: number;
  executionMode: ExecutionMode;
  createdBy: string;
  modifiedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
  versions?: RuleVersion[];
  approvals?: RuleApproval[];
  permissions?: RulePermission[];
  schedules?: RuleSchedule[];
  logs?: RuleExecutionLog[];
}

export type RuleType =
  | 'attendance'
  | 'payroll'
  | 'leave'
  | 'hr'
  | 'hospital'
  | 'incentive'
  | 'notification'
  | 'compliance'
  | 'custom';

export type ExecutionMode = 'sync' | 'async';

// =============================================================================
// RULE CATEGORY TYPES
// =============================================================================

export interface RuleCategory {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  parentId?: number;
  parent?: RuleCategory;
  subcategories?: RuleCategory[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  rules?: Rule[];
}

// =============================================================================
// RULE CONDITION TYPES
// =============================================================================

export interface RuleCondition {
  id: number;
  ruleId: number;
  parentId?: number;
  parent?: RuleCondition;
  children?: RuleCondition[];
  logicalOperator?: LogicalOperator;
  field: string;
  operator: ConditionOperator;
  value: string;
  valueType: ValueType;
  displayOrder: number;
}

export type LogicalOperator = 'AND' | 'OR';

export type ConditionOperator =
  | 'eq'      // Equal to
  | 'ne'      // Not equal to
  | 'gt'      // Greater than
  | 'lt'      // Less than
  | 'gte'     // Greater than or equal to
  | 'lte'     // Less than or equal to
  | 'contains'     // Contains
  | 'notContains'  // Does not contain
  | 'startsWith'   // Starts with
  | 'endsWith'      // Ends with
  | 'in'            // In list
  | 'notIn'         // Not in list
  | 'between';      // Between range

export type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'list'
  | 'json';

// =============================================================================
// RULE ACTION TYPES
// =============================================================================

export interface RuleAction {
  id: number;
  ruleId: number;
  groupId?: number;
  actionType: ActionType;
  targetField?: string;
  value?: string;
  valueType?: ActionValueType;
  formula?: string;
  amount?: number;
  percent?: number;
  notificationTemplate?: string;
  notificationRecipients?: string;
  minValue?: number;
  maxValue?: number;
  roundTo?: number;
  displayOrder: number;
}

export type ActionType =
  | 'set'              // Set field to value
  | 'add'              // Add value to field
  | 'subtract'         // Subtract value from field
  | 'multiply'         // Multiply field by value
  | 'divide'           // Divide field by value
  | 'sendNotification' // Send notification
  | 'approve'          // Approve entity
  | 'reject'           // Reject entity
  | 'calculate'        // Calculate formula
  | 'validate';        // Validate condition

export type ActionValueType =
  | 'fixed'
  | 'fieldReference'
  | 'formula'
  | 'percentage';

// =============================================================================
// RULE VERSION TYPES
// =============================================================================

export interface RuleVersion {
  id: number;
  ruleId: number;
  versionNumber: number;
  name: string;
  description?: string;
  conditions: any;
  actions: any;
  changeSummary?: string;
  modifiedBy: string;
  modifiedAt: Date;
  approvalStatus?: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
  isRollback: boolean;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// =============================================================================
// RULE APPROVAL TYPES
// =============================================================================

export interface RuleApproval {
  id: number;
  ruleId: number;
  requestedBy: string;
  requestedAt: Date;
  requestType: RequestType;
  changeSummary?: string;
  changes?: any;
  approvalLevel: number;
  requiredApprovals: number;
  currentApprovals: number;
  status: ApprovalStatus;
  approvers: any;
  approvals?: any;
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
}

export type RequestType =
  | 'create'
  | 'update'
  | 'activate'
  | 'deactivate'
  | 'delete';

// =============================================================================
// RULE PERMISSION TYPES
// =============================================================================

export interface RulePermission {
  id: number;
  ruleId: number;
  role: PermissionRole;
  permissions: PermissionType[];
  grantedBy: string;
  grantedAt: Date;
}

export type PermissionRole =
  | 'admin'
  | 'hr_manager'
  | 'payroll_manager'
  | 'department_head'
  | 'viewer';

export type PermissionType =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'activate'
  | 'test';

// =============================================================================
// RULE EXECUTION LOG TYPES
// =============================================================================

export interface RuleExecutionLog {
  id: number;
  ruleId: number;
  employeeId?: number;
  entityType?: string;
  entityId?: number;
  executedAt: Date;
  executionDuration?: number;
  triggerSource?: TriggerSource;
  inputData?: any;
  outputData?: any;
  matchedConditions?: any;
  executedActions?: any;
  status: ExecutionStatus;
  errorMessage?: string;
  errorCode?: string;
  executedBy?: string;
  batchId?: string;
}

export type TriggerSource =
  | 'manual'
  | 'scheduled'
  | 'api'
  | 'batch_job';

export type ExecutionStatus =
  | 'success'
  | 'failed'
  | 'partial'
  | 'skipped';

// =============================================================================
// RULE SCHEDULE TYPES
// =============================================================================

export interface RuleSchedule {
  id: number;
  ruleId: number;
  name: string;
  description?: string;
  scheduleType: ScheduleType;
  cronExpression?: string;
  intervalMinutes?: number;
  eventType?: string;
  isActive: boolean;
  runAsynchronously: boolean;
  timezone: string;
  startDate?: Date;
  endDate?: Date;
  lastExecutedAt?: Date;
  nextExecutionAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ScheduleType = 'cron' | 'interval' | 'event';

// =============================================================================
// AI RULE GENERATION TYPES
// =============================================================================

export interface AIRuleGenerationHistory {
  id: number;
  ruleId?: number;
  naturalLanguageQuery: string;
  clarifyingQuestions?: any;
  userAnswers?: any;
  aiProvider: AIProvider;
  modelUsed: string;
  tokensUsed: number;
  cost?: number;
  generatedRule: any;
  wasModified: boolean;
  wasSaved: boolean;
  userRating?: number;
  userFeedback?: string;
  requestedBy: string;
  createdAt: Date;
}

export type AIProvider = 'openai' | 'claude' | 'gemini';

// =============================================================================
// RULE EVALUATION TYPES
// =============================================================================

export interface RuleEvaluationContext {
  employee?: any;
  attendance?: any;
  payroll?: any;
  leave?: any;
  [key: string]: any;
}

export interface RuleEvaluationResult {
  ruleId: number;
  ruleName: string;
  matched: boolean;
  matchedConditions?: RuleCondition[];
  executedActions?: ExecutedAction[];
  calculatedAmount?: number;
  executionTime?: number;
  errorMessage?: string;
}

export interface ExecutedAction {
  type: ActionType;
  component?: string;
  amount: number;
  description: string;
  originalAction: RuleAction;
}

export interface BatchRuleEvaluationOptions {
  ruleType?: RuleType;
  categoryId?: number;
  employeeIds?: number[];
  entityType?: string;
  async?: boolean;
  batchSize?: number;
}

export interface RuleEvaluationSummary {
  totalRulesEvaluated: number;
  matchedRules: number;
  failedRules: number;
  executionDuration: number;
  results: RuleEvaluationResult[];
}

// =============================================================================
// RULE TESTING TYPES
// =============================================================================

export interface RuleTestContext {
  employeeId: number;
  testData: any;
  options?: RuleTestOptions;
}

export interface RuleTestOptions {
  dryRun?: boolean;
  verbose?: boolean;
  returnFullDetails?: boolean;
}

export interface RuleTestResult {
  success: boolean;
  matched: boolean;
  results: RuleEvaluationResult[];
  warnings?: string[];
  errors?: string[];
  testDuration: number;
}

// =============================================================================
// RULE VALIDATION TYPES
// =============================================================================

export interface RuleValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error';
}

export interface ValidationWarning {
  field: string;
  message: string;
  severity: 'warning';
}

// =============================================================================
// RULE IMPORT/EXPORT TYPES
// =============================================================================

export interface RuleExportOptions {
  format: ExportFormat;
  includeVersions?: boolean;
  includeLogs?: boolean;
  ruleIds?: number[];
  categories?: number[];
}

export type ExportFormat = 'json' | 'csv' | 'xml';

export interface RuleImportOptions {
  format: ExportFormat;
  validateOnly?: boolean;
  overwriteExisting?: boolean;
  preserveVersions?: boolean;
}

export interface RuleImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: ImportError[];
  warnings: string[];
}

export interface ImportError {
  rule: string;
  error: string;
  line?: number;
}

// =============================================================================
// ANALYTICS TYPES
// =============================================================================

export interface RuleAnalyticsMetrics {
  totalRules: number;
  activeRules: number;
  inactiveRules: number;
  executionsToday: number;
  executionsThisWeek: number;
  executionsThisMonth: number;
  failedExecutions: number;
  averageExecutionTime: number;
  mostExecutedRules: RuleUsage[];
  leastExecutedRules: RuleUsage[];
  topCategories: CategoryUsage[];
}

export interface RuleUsage {
  ruleId: number;
  ruleName: string;
  executionCount: number;
  lastExecuted: Date;
  successRate: number;
}

export interface CategoryUsage {
  categoryId: number;
  categoryName: string;
  ruleCount: number;
  executionCount: number;
}

export interface RuleKPIs {
  totalRules: number;
  activeRules: number;
  inactiveRules: number;
  rulesExecutedToday: number;
  failedExecutions: number;
  pendingApproval: number;
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

export interface CreateRuleRequest {
  name: string;
  description?: string;
  categoryId: number;
  ruleType: RuleType;
  conditions: Omit<RuleCondition, 'id' | 'ruleId'>[];
  actions: Omit<RuleAction, 'id' | 'ruleId'>[];
  priority?: number;
  executionMode?: ExecutionMode;
  createdBy: string;
}

export interface UpdateRuleRequest {
  name?: string;
  description?: string;
  categoryId?: number;
  ruleType?: RuleType;
  conditions?: Omit<RuleCondition, 'id' | 'ruleId'>[];
  actions?: Omit<RuleAction, 'id' | 'ruleId'>[];
  priority?: number;
  executionMode?: ExecutionMode;
  isActive?: boolean;
  modifiedBy?: string;
}

export interface EvaluateRulesRequest {
  context: RuleEvaluationContext;
  ruleType?: RuleType;
  ruleId?: number;
  employeeId?: number;
}

export interface GenerateRuleFromTextRequest {
  description: string;
  ruleType?: RuleType;
  categoryId?: number;
  provider?: AIProvider;
}

export interface TestRuleRequest {
  ruleId: number;
  testData: any;
  options?: RuleTestOptions;
}

export interface ApproveRuleRequest {
  approvedBy: string;
  comments?: string;
}

export interface RejectRuleRequest {
  rejectedBy: string;
  rejectionReason: string;
}

// =============================================================================
// UI-SPECIFIC TYPES
// =============================================================================

export interface RuleFormData {
  name: string;
  description: string;
  categoryId: number;
  ruleType: RuleType;
  priority: number;
  executionMode: ExecutionMode;
  conditions: ConditionFormData[];
  actions: ActionFormData[];
}

export interface ConditionFormData {
  id?: string;
  field: string;
  operator: ConditionOperator;
  value: string;
  valueType: ValueType;
  logicalOperator?: LogicalOperator;
}

export interface ActionFormData {
  id?: string;
  actionType: ActionType;
  targetField?: string;
  valueType?: ActionValueType;
  value?: string;
  amount?: number;
  percent?: number;
  formula?: string;
}

export interface RuleListFilter {
  search?: string;
  categoryId?: number;
  ruleType?: RuleType;
  status?: 'active' | 'inactive' | 'all';
  priorityMin?: number;
  priorityMax?: number;
  createdBy?: string;
}

export interface RuleAnalyticsFilter {
  dateFrom?: Date;
  dateTo?: Date;
  ruleType?: RuleType;
  categoryId?: number;
  employeeId?: number;
  status?: ExecutionStatus;
}
