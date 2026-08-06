# HR Pulse ↔ Adamrit — Discovery Prompts

This file holds ready-to-paste prompts for a Claude Code CLI session. They are
**discovery and design** prompts: each one is explicitly read-only, so nothing gets
built before both schemas are understood.

Run them in order:

| Prompt | Where to run it | Purpose |
|---|---|---|
| **A** | A session with the **HR Pulse** repo (this one) | Audit what exists here and list the gaps |
| **B** | A separate session with the **Adamrit** repo | Audit the accounting / ledger / voucher side |
| **C** | Either session, pasting the A and B outputs in | Design the integration contract + ID strategy |

Copy everything inside a fenced block, from `# TASK:` to the end of that block.

---

## Business context (shared by all three prompts)

- **HR Pulse** is the system of record for the **employee master table**. It handles
  attendance, late-coming, shift rules and salary calculation.
- **Adamrit** is a live production HIMS containing the **accounting module**. Every
  employee has their own **ledger** there, used to pay salary. Ledgers, vouchers and
  journal vouchers are created in Adamrit from data pushed by HR Pulse over an API.
- The identifier used by the **biometric device/software** must be changed to the
  **Adamrit employee ledger ID**, so one identity key spans both systems.
- Shift rules are **role-based**. In scope right now:
  - **Nurses:** `08:00–14:00`, `14:00–20:00`, `08:00–20:00`
  - **General staff** (admin, billing, ward boys, everyone else): `09:00–18:00`
- **Out of scope for now:** doctors and resident medical officers (RMOs). Note where
  their rules would plug in; do not design them.

---

## Prompt A — HR Pulse audit (run in this repo)

````markdown
# TASK: Audit HR Pulse for the Adamrit accounting integration — DISCOVERY ONLY

You have access to the HR Pulse repo only. Adamrit (the hospital HIMS with the
accounting module) is NOT in this session — do not guess at its schema; where you
need something from it, write it into an "Information needed from Adamrit" list.

## Context you may treat as given

- HR Pulse is the system of record for the employee master. It computes attendance,
  late-coming and salary, then pushes the result to Adamrit over an API, where the
  ledger / voucher / journal voucher entries are posted.
- Every employee has a salary **ledger** in Adamrit's accounting module.
- The biometric device's employee ID must become the **Adamrit employee ledger ID**,
  so one key identifies a person in both systems.
- Role-based shift rules, in scope now:
  - Nurses: 08:00–14:00, 14:00–20:00, 08:00–20:00
  - General staff (admin, billing, ward boys, all others): 09:00–18:00
  - Out of scope now: doctors / RMOs — note the plug-in point only.

## Rules

- **Read-only.** No edits, no migrations, no scaffolding, no `prisma migrate`, no
  writes to any database. You may create exactly one file: the report named below.
- Cite `file:line` for every factual claim about the code.
- If something does not exist, write **NOT FOUND**. Never invent a table, column or
  function that isn't in the repo, and never describe a planned design as if it were
  current behaviour.
- Keep "what the code does today" and "what it would need to do" in separate sections.

## 1. Inventory

Stack, workspaces, package manager, deploy config, how the app boots, where env/config
would live for an outbound Adamrit client. Where the DB schema is defined and how
migrations are applied in deploy.

## 2. Schema extraction

From the Prisma schema, list every model: table name, fields, types, PK, uniques,
indexes, relations — quoted from the file with line references. Then render an ER
diagram in a mermaid fence.

Call out explicitly, as present or NOT FOUND, each of:
employee master · role/designation table · biometric device or punch record ·
attendance · shift definition · shift assignment · leave · holiday · salary
components · payroll run · payslip · any external-system ID column.

## 3. Identity audit — the core question

- Enumerate **every** identifier used for a person anywhere in this repo (DB columns,
  Excel import columns, email keys, API params). For each: where it is generated, its
  type, whether it is unique, whether it is nullable, whether it is stable over time.
- Show the current join path from an attendance row back to a person, and say whether
  any path to an external accounting system exists today.
- Then assess the proposal *"make the biometric employee ID equal to the Adamrit
  ledger ID"* against what you found here:
  - Which column would hold it? Is that column currently unique and non-null? What
    would have to change?
  - What breaks: existing attendance history, re-hires (same person, new ledger),
    employees onboarded before a ledger exists, employees with no ledger at all,
    imports whose sheet still carries the old device ID.
  - Compare two strategies and recommend one with reasons:
    1. Use the Adamrit ledger ID directly as the employee key here.
    2. Keep a stable internal PK and add an `adamritLedgerId` mapping column with a
       unique constraint plus a "not yet linked" state.
  - Flag anything that needs a human decision rather than assuming it.

## 4. Calculation trace

Trace the real, current code path end to end with `file:line` citations:

attendance ingestion → per-day record → status derivation → rule evaluation →
deduction / salary calculation → downstream output.

For each stage state whether it exists, is partial, or is absent. In particular
answer, from the code and not from assumption:

- Where does attendance data actually come from — a biometric device feed, or a file
  import? Are raw punch **times** stored, or only a status per day?
- Is "late coming" **computed** from a scheduled start time, or **read** from the
  source data? Is there any grace period, half-day, or overtime logic?
- What does the rule engine evaluate over, and what does it emit?
- What does the salary/deduction calculation take as input, and what does it produce —
  a stored payroll artifact, or a computed-on-request response?

## 5. Gap analysis — role-based shift rules

Given the four shifts above:

- Is the employee's **role** modelled well enough to key a shift off it, or is it free
  text? What would a proper role reference require, and what existing data would need
  backfilling?
- Where would shift definitions and per-employee (or per-employee-per-date) shift
  assignments live? Does anything in the current schema come close?
- How would the 12-hour nurse shift (08:00–20:00) and any shift crossing midnight be
  represented and evaluated? What breaks if attendance is keyed by calendar date only?
- What is the minimum data that must be captured per day for late-coming to be
  *computed* rather than *imported*?

## 6. Gap analysis — salary → Adamrit posting

- What salary inputs exist today, and what is missing for a real payslip (earnings,
  deductions, employer contributions, net pay)?
- Is there any persisted payroll run / period-close concept? If not, explain why one
  is required before vouchers can be posted idempotently.
- List what a voucher push would need from HR Pulse: per-employee amount, ledger
  reference, period, voucher narration, and a stable idempotency key.

## 7. Reuse first

Before proposing anything new, identify the existing building blocks that should be
extended rather than duplicated — the rule storage and evaluation path, the key/value
settings mechanism, the existing services layer and route conventions. Name them with
paths, and say for each whether extending it is genuinely a better fit than a new
table or service.

## 8. Information needed from Adamrit

A precise list of questions to answer in the Adamrit session — ledger ID format and
stability, voucher creation requirements, period locking, auth — so Prompt B can be
run against the right targets.

## Output

Write to `docs/HRPULSE_ADAMRIT_AUDIT.md` in this repo, with sections:

1. Executive summary (≤ 20 lines)
2. Inventory
3. Schema + ER diagram
4. Identity audit and ID-strategy recommendation
5. Calculation trace (exists / partial / absent per stage)
6. Gap list — shift rules
7. Gap list — payroll and voucher posting
8. Reuse opportunities
9. Information needed from Adamrit
10. Open questions for me to decide, each with your recommended default

Stop when the report is written. Do not implement anything.
````

---

## Prompt B — Adamrit audit (run in a session that has the Adamrit repo)

````markdown
# TASK: Audit the Adamrit accounting module for an inbound payroll integration —
# DISCOVERY ONLY

Adamrit is a **live production** hospital management system. HR Pulse, a separate HR
module, computes attendance and salary and will push results here over an API so that
ledger entries, vouchers and journal vouchers are created.

## Rules

- **Read-only, and this is production.** No edits, no migrations, no seeds, no writes,
  no destructive or state-changing commands of any kind. You may create exactly one
  file: the report named below.
- Cite `file:line` for every claim. Write **NOT FOUND** rather than guessing.

## 1. Inventory

Stack, framework, database engine, ORM/query layer, where schema and migrations live,
how the app is deployed, how authentication works for API callers, and whether there is
any existing inbound integration or webhook surface.

## 2. Accounting schema

Extract the real schema (fields, PK/FK, uniques, indexes) for everything in the
accounting path, with line references, then render a mermaid ER diagram:

- staff / employee records
- chart of accounts, ledger groups, ledgers — especially **employee salary ledgers**
- voucher types, vouchers, voucher line items / entries
- journal vouchers
- accounting periods, financial years, and any period-lock or closing mechanism
- any existing HR, attendance or payroll tables

## 3. The ledger ID — answer precisely

- What is the primary identifier of an employee's salary ledger? Its exact type
  (autoincrement integer, UUID, human-entered account code, composite?), how it is
  generated, its length and character constraints.
- Is it **immutable** once created, or can it be edited/renumbered? Show the code path
  that would change it, if any.
- How is a ledger currently associated with a staff member — a real FK, a name match,
  or nothing at all?
- What happens on: employee deletion, ledger deactivation, an employee with two
  ledgers, a re-hired employee.
- Would this value be usable as the identifier stored on a biometric device — is it
  short enough and numeric enough for typical device constraints?

## 4. Voucher creation path

Trace how a voucher / journal voucher is created today (UI action → handler → service →
DB write), with citations. Then document, as a contract:

- required input fields and their validation rules
- which references must already exist (ledger, voucher type, period)
- whether entries must balance, and how that is enforced
- how the voucher number is allocated, and whether it is sequential per type/year
- what happens on a duplicate submission — is there any idempotency or uniqueness guard?
- what happens if the target period is locked or the financial year is closed
- whether a posted voucher can be amended or reversed, and how

## 5. Integration surface

- Is there an existing API layer an external service could call? Auth mechanism,
  rate limits, error format, transaction boundaries.
- If there is none, identify the cleanest insertion point for a new inbound endpoint
  that reuses the existing voucher service rather than writing to tables directly.

## 6. Hazards

List the concrete risks of accepting payroll postings from an external system:
partial posting, duplicate vouchers on retry, salary recalculated after posting,
employee/ledger deleted upstream, period closed between calculation and posting,
currency/rounding mismatches.

## Output

Write to `docs/ADAMRIT_PAYROLL_INTEGRATION_AUDIT.md` in the Adamrit repo, sections:

1. Executive summary (≤ 20 lines)
2. Inventory
3. Accounting schema + ER diagram
4. Ledger ID — format, generation, stability, staff association
5. Voucher creation contract
6. Integration surface (existing or proposed insertion point)
7. Hazards
8. Open questions for me to decide, each with a recommended default

Stop when the report is written. Do not implement anything, and do not touch
production data.
````

---

## Prompt C — Integration contract design (run after A and B)

````markdown
# TASK: Design the HR Pulse → Adamrit payroll integration contract — DESIGN ONLY,
# NO CODE

I am pasting two audit reports below: the HR Pulse audit (Prompt A) and the Adamrit
audit (Prompt B). Base every decision on what those reports actually say. If a report
says NOT FOUND or leaves something unanswered, treat it as unknown and list it as a
blocker — do not fill the gap with an assumption.

--- HR PULSE AUDIT ---
<paste docs/HRPULSE_ADAMRIT_AUDIT.md here>

--- ADAMRIT AUDIT ---
<paste docs/ADAMRIT_PAYROLL_INTEGRATION_AUDIT.md here>

## Produce

### 1. Identity strategy (decide and justify)

Direct reuse of the Adamrit ledger ID as the HR Pulse employee key, versus a stable
internal PK plus a unique `adamritLedgerId` mapping column. Use the ledger ID's actual
type and mutability from the Adamrit audit as the deciding evidence. Cover:
onboarding before a ledger exists, re-hires, the biometric device's field constraints,
and how the existing attendance history gets migrated either way.

### 2. Role and shift model

A concrete data model for role-based shifts supporting nurses at 08:00–14:00,
14:00–20:00 and 08:00–20:00, and general staff at 09:00–18:00, with a clean extension
point for doctors/RMOs later. Specify how a shift is resolved for a given employee on a
given date, how the 12-hour and any midnight-crossing shift are handled, and where
grace period / half-day / overtime thresholds are configured.

### 3. Attendance → payroll → posting flow

The full pipeline as a sequence: ingestion → daily attendance with computed
late-coming → rule evaluation → payroll run for a period → per-employee payslip →
push to Adamrit → voucher posted → confirmation stored. Name the state each artifact is
in at each step.

### 4. API contract

Endpoint, auth, and the exact request/response JSON for the salary push — including
the idempotency key and its derivation, batch vs per-employee semantics, partial
failure behaviour, and the field-by-field mapping from HR Pulse payroll data to
Adamrit's voucher input requirements.

### 5. Failure and reconciliation

Retry safety, duplicate-voucher prevention, what happens when payroll is recalculated
after a voucher is already posted, period-locked rejections, and how to reconcile the
two systems if they diverge.

### 6. Migration and rollout

Ordered steps to get from the current HR Pulse state to this design, each one
independently deployable, with the backfill required at each step and what is reversible.

### 7. Blockers

Everything that cannot be decided without more information, and exactly what
information is needed.

Output as a single markdown document. Do not write application code, schema files or
migrations in this pass.
````

---

## Open questions to settle before implementation

These need answers from you, not from the codebase:

1. **Ledger ID format and stability** — is it an integer, a UUID, or a typed account
   code? Can it ever change after creation?
2. **Biometric device constraints** — what field length and character set does the
   device accept for an employee ID? This determines whether the ledger ID can be used
   there directly.
3. **Attendance source** — does the biometric feed replace today's Excel import, or run
   alongside it during transition? Will raw in/out punch times be available, or only a
   per-day status?
4. **Thresholds per shift** — grace period for late coming, what counts as half-day vs
   absent, and whether overtime is paid or ignored. These differ between the nurse
   shifts and the 09:00–18:00 general shift and must be stated per shift.
5. **Posting granularity** — one consolidated journal voucher per payroll period, or
   one voucher per employee? This drives the idempotency key design.
6. **Ledger-less employees** — what should happen when payroll is run for someone who
   has no Adamrit ledger yet: block the run, skip them, or post to a suspense ledger?
