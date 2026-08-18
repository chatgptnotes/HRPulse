-- ============================================================================
-- HRPulse Rules Engine — Complete Enterprise Schema
-- Applied via Supabase SQL Editor (direct 5432 blocked on this network)
-- Idempotent: safe to re-run (IF NOT EXISTS / ON CONFLICT guards)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RULE CATEGORIES
-- ----------------------------------------------------------------------------
create table if not exists rule_categories (
  id          serial primary key,
  name        text not null unique,
  description text,
  icon        text,
  color       text,
  parent_id   integer references rule_categories(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_rule_categories_active on rule_categories(is_active);
create index if not exists idx_rule_categories_parent on rule_categories(parent_id);

-- ----------------------------------------------------------------------------
-- 2. RULES (master definitions)
-- ----------------------------------------------------------------------------
create table if not exists rules (
  id             serial primary key,
  name           text not null,
  description    text,
  category_id    integer not null references rule_categories(id) on delete restrict,
  rule_type      text not null check (rule_type in
    ('attendance','payroll','leave','hr','hospital','incentive','notification','compliance','custom')),
  is_active      boolean not null default true,
  priority       integer not null default 0,
  execution_mode text not null default 'sync' check (execution_mode in ('sync','async')),
  created_by     text not null default 'system',
  modified_by    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_rules_category on rules(category_id);
create index if not exists idx_rules_type on rules(rule_type);
create index if not exists idx_rules_active on rules(is_active);
create index if not exists idx_rules_priority on rules(priority desc);

-- ----------------------------------------------------------------------------
-- 3. RULE CONDITIONS (IF / AND / OR tree, nested groups via parent_id)
-- ----------------------------------------------------------------------------
create table if not exists rule_conditions (
  id               serial primary key,
  rule_id          integer not null references rules(id) on delete cascade,
  parent_id        integer references rule_conditions(id) on delete cascade,
  logical_operator text check (logical_operator in ('AND','OR')),
  field            text not null,
  operator         text not null check (operator in
    ('eq','ne','gt','lt','gte','lte','contains','notContains','startsWith','endsWith','in','notIn','between')),
  value            text not null,
  value_type       text not null default 'string' check (value_type in
    ('string','number','boolean','date','list','json')),
  display_order    integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_rule_conditions_rule on rule_conditions(rule_id);
create index if not exists idx_rule_conditions_parent on rule_conditions(parent_id);

-- ----------------------------------------------------------------------------
-- 4. RULE ACTIONS (THEN logic)
-- ----------------------------------------------------------------------------
create table if not exists rule_actions (
  id                      serial primary key,
  rule_id                 integer not null references rules(id) on delete cascade,
  group_id                integer,
  action_type             text not null check (action_type in
    ('set','add','subtract','multiply','divide','sendNotification','approve','reject','calculate','validate')),
  target_field            text,
  value                   text,
  value_type              text check (value_type in ('fixed','fieldReference','formula','percentage')),
  formula                 text,
  amount                  numeric(10,2),
  percent                 numeric(5,2),
  notification_template   text,
  notification_recipients text,
  min_value               numeric(10,2),
  max_value               numeric(10,2),
  round_to                integer,
  display_order           integer not null default 0,
  created_at              timestamptz not null default now()
);
create index if not exists idx_rule_actions_rule on rule_actions(rule_id);
create index if not exists idx_rule_actions_group on rule_actions(group_id);

-- ----------------------------------------------------------------------------
-- 5. RULE VERSIONS (immutable audit snapshots — never deleted)
-- ----------------------------------------------------------------------------
create table if not exists rule_versions (
  id               serial primary key,
  rule_id          integer not null references rules(id) on delete cascade,
  version_number   integer not null,
  name             text not null,
  description      text,
  conditions       jsonb not null default '[]'::jsonb,
  actions          jsonb not null default '[]'::jsonb,
  change_summary   text,
  modified_by      text not null default 'system',
  modified_at      timestamptz not null default now(),
  approval_status  text check (approval_status in ('pending','approved','rejected')),
  approved_by      text,
  approved_at      timestamptz,
  rejection_reason text,
  is_rollback      boolean not null default false
);
create unique index if not exists uq_rule_versions on rule_versions(rule_id, version_number);
create index if not exists idx_rule_versions_rule on rule_versions(rule_id);

-- ----------------------------------------------------------------------------
-- 6. RULE APPROVALS (maker-checker workflow)
-- ----------------------------------------------------------------------------
create table if not exists rule_approvals (
  id                 serial primary key,
  rule_id            integer not null references rules(id) on delete cascade,
  requested_by       text not null,
  requested_at       timestamptz not null default now(),
  request_type       text not null check (request_type in ('create','update','activate','deactivate','delete')),
  change_summary     text,
  changes            jsonb,
  approval_level     integer not null default 1,
  required_approvals integer not null default 1,
  current_approvals  integer not null default 0,
  status             text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  approvers          jsonb not null default '[]'::jsonb,
  approvals          jsonb,
  approved_by        text,
  approved_at        timestamptz,
  rejection_reason   text
);
create index if not exists idx_rule_approvals_rule on rule_approvals(rule_id);
create index if not exists idx_rule_approvals_status on rule_approvals(status);

-- ----------------------------------------------------------------------------
-- 7. RULE EXECUTION LOGS (complete audit trail)
-- ----------------------------------------------------------------------------
create table if not exists rule_execution_logs (
  id                 serial primary key,
  rule_id            integer not null references rules(id) on delete cascade,
  employee_id        integer,
  employee_name      text,
  entity_type        text,
  entity_id          integer,
  executed_at        timestamptz not null default now(),
  execution_duration integer,
  trigger_source     text check (trigger_source in ('manual','scheduled','api','batch_job')),
  input_data         jsonb,
  output_data        jsonb,
  matched_conditions jsonb,
  executed_actions   jsonb,
  status             text not null check (status in ('success','failed','partial','skipped')),
  error_message      text,
  error_code         text,
  executed_by        text,
  batch_id           text
);
create index if not exists idx_rel_rule on rule_execution_logs(rule_id);
create index if not exists idx_rel_employee on rule_execution_logs(employee_id);
create index if not exists idx_rel_status on rule_execution_logs(status);
create index if not exists idx_rel_executed_at on rule_execution_logs(executed_at desc);
create index if not exists idx_rel_entity on rule_execution_logs(entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- 8. RULE PERMISSIONS (RBAC per rule)
-- ----------------------------------------------------------------------------
create table if not exists rule_permissions (
  id          serial primary key,
  rule_id     integer not null references rules(id) on delete cascade,
  role        text not null check (role in ('admin','hr_manager','payroll_manager','department_head','viewer')),
  permissions jsonb not null default '[]'::jsonb,
  granted_by  text not null default 'system',
  granted_at  timestamptz not null default now()
);
create index if not exists idx_rule_permissions_rule on rule_permissions(rule_id);
create index if not exists idx_rule_permissions_role on rule_permissions(role);

-- ----------------------------------------------------------------------------
-- 9. RULE SCHEDULES
-- ----------------------------------------------------------------------------
create table if not exists rule_schedules (
  id                 serial primary key,
  rule_id            integer not null references rules(id) on delete cascade,
  name               text not null,
  description        text,
  schedule_type      text not null check (schedule_type in ('cron','interval','event')),
  cron_expression    text,
  interval_minutes   integer,
  event_type         text,
  is_active          boolean not null default true,
  run_asynchronously boolean not null default false,
  timezone           text not null default 'UTC',
  start_date         timestamptz,
  end_date           timestamptz,
  last_executed_at   timestamptz,
  next_execution_at  timestamptz,
  created_by         text not null default 'system',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_rule_schedules_rule on rule_schedules(rule_id);
create index if not exists idx_rule_schedules_next on rule_schedules(next_execution_at);

-- ----------------------------------------------------------------------------
-- 10. AI RULE GENERATION HISTORY (feedback loop)
-- ----------------------------------------------------------------------------
create table if not exists ai_rule_generation_history (
  id                     serial primary key,
  rule_id                integer references rules(id) on delete set null,
  natural_language_query text not null,
  clarifying_questions   jsonb,
  user_answers           jsonb,
  ai_provider            text not null default 'gemini',
  model_used             text not null default '',
  tokens_used            integer not null default 0,
  cost                   numeric(8,4),
  generated_rule         jsonb not null default '{}'::jsonb,
  was_modified           boolean not null default false,
  was_saved              boolean not null default false,
  user_rating            integer,
  user_feedback          text,
  requested_by           text not null default 'system',
  created_at             timestamptz not null default now()
);
create index if not exists idx_airgh_rule on ai_rule_generation_history(rule_id);
create index if not exists idx_airgh_requested_by on ai_rule_generation_history(requested_by);
create index if not exists idx_airgh_created_at on ai_rule_generation_history(created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY — authenticated users manage the rules engine
-- ============================================================================
alter table rule_categories            enable row level security;
alter table rules                      enable row level security;
alter table rule_conditions            enable row level security;
alter table rule_actions               enable row level security;
alter table rule_versions              enable row level security;
alter table rule_approvals             enable row level security;
alter table rule_execution_logs        enable row level security;
alter table rule_permissions           enable row level security;
alter table rule_schedules             enable row level security;
alter table ai_rule_generation_history enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'rule_categories','rules','rule_conditions','rule_actions','rule_versions',
    'rule_approvals','rule_execution_logs','rule_permissions','rule_schedules',
    'ai_rule_generation_history'
  ]
  loop
    execute format('drop policy if exists "rules_engine_authenticated_all" on %I', t);
    execute format(
      'create policy "rules_engine_authenticated_all" on %I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- ============================================================================
-- SEED: 16 enterprise categories
-- ============================================================================
insert into rule_categories (name, description, icon, color) values
  ('Attendance',            'Attendance tracking, half-day, late and swipe rules',  'schedule',            'bg-blue-500'),
  ('Payroll',               'Salary calculation, deductions and allowances',        'payments',            'bg-emerald-500'),
  ('Leave Management',      'Leave balance, approval and accrual rules',            'event_busy',          'bg-purple-500'),
  ('HR Operations',         'Employee lifecycle and HR processes',                  'people',              'bg-pink-500'),
  ('Recruitment',           'Hiring funnel and candidate workflow rules',           'person_search',       'bg-cyan-500'),
  ('Performance Management','Appraisals, KPIs and review cycles',                   'trending_up',         'bg-orange-500'),
  ('Employee Lifecycle',    'Onboarding, transfers, promotions and exits',          'sync_alt',            'bg-teal-500'),
  ('Hospital Billing',      'Hospital billing, invoicing and charge rules',         'local_hospital',      'bg-red-500'),
  ('Incentives',            'Bonus, commission and incentive calculations',         'emoji_events',        'bg-amber-500'),
  ('Notifications',         'Alerts, reminders and notification triggers',          'notifications',       'bg-indigo-500'),
  ('Compliance',            'Regulatory and statutory policy rules',                'verified_user',       'bg-green-600'),
  ('Security',              'Access control and security policies',                 'security',            'bg-slate-500'),
  ('Access Control',        'Role and permission gating rules',                     'admin_panel_settings','bg-slate-600'),
  ('Accounting',            'Ledger, journal and account posting rules',            'account_balance',     'bg-orange-700'),
  ('Finance',               'Budgets, approvals and financial thresholds',          'attach_money',        'bg-lime-600'),
  ('Custom',                'User-defined custom rules',                            'tune',                'bg-gray-500')
on conflict (name) do nothing;

-- ============================================================================
-- SEED: starter rules (the canonical examples from the spec)
-- ============================================================================
do $$
declare
  v_attendance_cat int; v_payroll_cat int; v_notification_cat int;
  v_rule int;
  v_cond_json jsonb; v_act_json jsonb;
begin
  select id into v_attendance_cat  from rule_categories where name = 'Attendance';
  select id into v_payroll_cat     from rule_categories where name = 'Payroll';
  select id into v_notification_cat from rule_categories where name = 'Notifications';

  -- Rule 1: IF Working Hours < 4 THEN Mark Attendance = Half Day
  if not exists (select 1 from rules where name = 'Half Day — Working Hours Below 4') then
    insert into rules (name, description, category_id, rule_type, is_active, priority, execution_mode, created_by)
    values ('Half Day — Working Hours Below 4',
            'IF Working Hours < 4 THEN Mark Attendance = Half Day',
            v_attendance_cat, 'attendance', true, 30, 'sync', 'system')
    returning id into v_rule;
    insert into rule_conditions (rule_id, field, operator, value, value_type, display_order)
    values (v_rule, 'attendance.workingHours', 'lt', '"4"', 'number', 0);
    insert into rule_actions (rule_id, action_type, target_field, value, value_type, display_order)
    values (v_rule, 'set', 'attendance.status', '"Half Day"', 'fixed', 0);
    select jsonb_agg(to_jsonb(c) - 'id' - 'rule_id' - 'created_at') into v_cond_json from rule_conditions c where c.rule_id = v_rule;
    select jsonb_agg(to_jsonb(a) - 'id' - 'rule_id' - 'created_at') into v_act_json from rule_actions a where a.rule_id = v_rule;
    insert into rule_versions (rule_id, version_number, name, description, conditions, actions, change_summary, modified_by)
    values (v_rule, 1, 'Half Day — Working Hours Below 4',
            'IF Working Hours < 4 THEN Mark Attendance = Half Day',
            v_cond_json, v_act_json, 'Initial version', 'system');
  end if;

  -- Rule 2: IF Late Count > 3 THEN Salary Deduction ₹500
  if not exists (select 1 from rules where name = 'Late Arrival — ₹500 Salary Deduction') then
    insert into rules (name, description, category_id, rule_type, is_active, priority, execution_mode, created_by)
    values ('Late Arrival — ₹500 Salary Deduction',
            'IF Late Count > 3 THEN Salary Deduction = ₹500',
            v_payroll_cat, 'payroll', true, 20, 'sync', 'system')
    returning id into v_rule;
    insert into rule_conditions (rule_id, field, operator, value, value_type, display_order)
    values (v_rule, 'attendance.lateCount', 'gt', '"3"', 'number', 0);
    insert into rule_actions (rule_id, action_type, target_field, value_type, amount, display_order)
    values (v_rule, 'subtract', 'salary.deductions', 'fixed', 500, 0);
    select jsonb_agg(to_jsonb(c) - 'id' - 'rule_id' - 'created_at') into v_cond_json from rule_conditions c where c.rule_id = v_rule;
    select jsonb_agg(to_jsonb(a) - 'id' - 'rule_id' - 'created_at') into v_act_json from rule_actions a where a.rule_id = v_rule;
    insert into rule_versions (rule_id, version_number, name, description, conditions, actions, change_summary, modified_by)
    values (v_rule, 1, 'Late Arrival — ₹500 Salary Deduction',
            'IF Late Count > 3 THEN Salary Deduction = ₹500',
            v_cond_json, v_act_json, 'Initial version', 'system');
  end if;

  -- Rule 3: IF Day = Sunday THEN Overtime Multiplier = 2
  if not exists (select 1 from rules where name = 'Sunday Overtime — 2x Multiplier') then
    insert into rules (name, description, category_id, rule_type, is_active, priority, execution_mode, created_by)
    values ('Sunday Overtime — 2x Multiplier',
            'IF Day = Sunday THEN Overtime Multiplier = 2',
            v_payroll_cat, 'payroll', true, 25, 'sync', 'system')
    returning id into v_rule;
    insert into rule_conditions (rule_id, field, operator, value, value_type, display_order)
    values (v_rule, 'attendance.dayOfWeek', 'eq', '"Sunday"', 'string', 0);
    insert into rule_actions (rule_id, action_type, target_field, value, value_type, display_order)
    values (v_rule, 'set', 'salary.overtimeMultiplier', '"2"', 'fixed', 0);
    select jsonb_agg(to_jsonb(c) - 'id' - 'rule_id' - 'created_at') into v_cond_json from rule_conditions c where c.rule_id = v_rule;
    select jsonb_agg(to_jsonb(a) - 'id' - 'rule_id' - 'created_at') into v_act_json from rule_actions a where a.rule_id = v_rule;
    insert into rule_versions (rule_id, version_number, name, description, conditions, actions, change_summary, modified_by)
    values (v_rule, 1, 'Sunday Overtime — 2x Multiplier',
            'IF Day = Sunday THEN Overtime Multiplier = 2',
            v_cond_json, v_act_json, 'Initial version', 'system');
  end if;

  -- Rule 4: IF Leave Balance <= 2 THEN Send Notification
  if not exists (select 1 from rules where name = 'Low Leave Balance — Notify Employee & HR') then
    insert into rules (name, description, category_id, rule_type, is_active, priority, execution_mode, created_by)
    values ('Low Leave Balance — Notify Employee & HR',
            'IF Leave Balance <= 2 THEN Send Notification',
            v_notification_cat, 'notification', true, 10, 'async', 'system')
    returning id into v_rule;
    insert into rule_conditions (rule_id, field, operator, value, value_type, display_order)
    values (v_rule, 'leave.balance', 'lte', '"2"', 'number', 0);
    insert into rule_actions (rule_id, action_type, notification_template, notification_recipients, display_order)
    values (v_rule, 'sendNotification', 'low_leave_balance', '["employee","hr_manager"]', 0);
    select jsonb_agg(to_jsonb(c) - 'id' - 'rule_id' - 'created_at') into v_cond_json from rule_conditions c where c.rule_id = v_rule;
    select jsonb_agg(to_jsonb(a) - 'id' - 'rule_id' - 'created_at') into v_act_json from rule_actions a where a.rule_id = v_rule;
    insert into rule_versions (rule_id, version_number, name, description, conditions, actions, change_summary, modified_by)
    values (v_rule, 1, 'Low Leave Balance — Notify Employee & HR',
            'IF Leave Balance <= 2 THEN Send Notification',
            v_cond_json, v_act_json, 'Initial version', 'system');
  end if;

  -- Rule 5: IF Absent Days >= 3 THEN Escalate to HR Director
  if not exists (select 1 from rules where name = 'Repeated Absence — Escalate to HR Director') then
    insert into rules (name, description, category_id, rule_type, is_active, priority, execution_mode, created_by)
    values ('Repeated Absence — Escalate to HR Director',
            'IF Absent Days >= 3 in a month THEN send escalation notification to HR Director',
            v_attendance_cat, 'attendance', true, 40, 'async', 'system')
    returning id into v_rule;
    insert into rule_conditions (rule_id, field, operator, value, value_type, display_order)
    values (v_rule, 'attendance.absentDays', 'gte', '"3"', 'number', 0);
    insert into rule_actions (rule_id, action_type, notification_template, notification_recipients, display_order)
    values (v_rule, 'sendNotification', 'escalation', '["hr_director","manager"]', 0);
    select jsonb_agg(to_jsonb(c) - 'id' - 'rule_id' - 'created_at') into v_cond_json from rule_conditions c where c.rule_id = v_rule;
    select jsonb_agg(to_jsonb(a) - 'id' - 'rule_id' - 'created_at') into v_act_json from rule_actions a where a.rule_id = v_rule;
    insert into rule_versions (rule_id, version_number, name, description, conditions, actions, change_summary, modified_by)
    values (v_rule, 1, 'Repeated Absence — Escalate to HR Director',
            'IF Absent Days >= 3 in a month THEN send escalation notification to HR Director',
            v_cond_json, v_act_json, 'Initial version', 'system');
  end if;
end $$;