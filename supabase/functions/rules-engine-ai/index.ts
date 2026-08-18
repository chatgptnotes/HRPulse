/**
 * Rules Engine AI — Gemini-powered natural language rule generator.
 *
 * POST /functions/v1/rules-engine-ai
 *   { "instruction": "If employee works less than 4 hours mark half day",
 *     "answers"?: { "question id": "answer" } }
 *
 * Response (complete):
 *   { "status": "complete", "rule": { name, description, ruleType, priority,
 *       executionMode, conditions: [...], actions: [...], explanation } }
 *
 * Response (needs clarification):
 *   { "status": "clarify", "questions": [{ id, question, type, options? }] }
 *
 * Conditions use the shared rules-engine contract:
 *   { field, operator, value, valueType, logicalOperator?, parentId? }
 * Actions:
 *   { actionType, targetField?, value?, amount?, percent?, formula?,
 *     notificationTemplate?, notificationRecipients? }
 *
 * Every generation is logged to ai_rule_generation_history.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const OPERATORS = ['eq','ne','gt','lt','gte','lte','contains','notContains','startsWith','endsWith','in','notIn','between'];
const VALUE_TYPES = ['string','number','boolean','date','list','json'];
const ACTION_TYPES = ['set','add','subtract','multiply','divide','sendNotification','approve','reject','calculate','validate'];
const RULE_TYPES = ['attendance','payroll','leave','hr','hospital','incentive','notification','compliance','custom'];

const FIELD_CATALOG = `
Available condition fields (dot notation, evaluated against a context object):
- employee.id, employee.name, employee.designation, employee.department, employee.organisation, employee.branch, employee.status, employee.joiningDate, employee.monthlySalary, employee.shiftName
- attendance.workingHours, attendance.status, attendance.dayOfWeek (Monday..Sunday), attendance.isWeekend, attendance.isHoliday, attendance.lateMinutes, attendance.earlyMinutes, attendance.lateCount (late days this month), attendance.absentDays (absent days this month), attendance.missedSwipeCount, attendance.overtimeHours, attendance.presentDays, attendance.halfDays, attendance.timeIn, attendance.timeOut
- payroll.basicSalary, payroll.grossSalary, payroll.netSalary, payroll.deductions, payroll.allowances, payroll.lostPayDays, payroll.period
- leave.balance, leave.takenThisMonth, leave.pendingRequests, leave.type
Common action target fields: attendance.status, salary.deductions, salary.overtimeMultiplier, salary.bonus, leave.balance, payroll.netSalary`;

const SYSTEM_PROMPT = `You convert natural-language HR policy instructions into structured rules for a rules engine.

${FIELD_CATALOG}

Return ONLY JSON, one of two shapes:

1. Instruction is complete enough to build a rule:
{"status":"complete","rule":{"name":"short imperative name","description":"one line","ruleType":"${RULE_TYPES.join('|')}","priority":0-100,"executionMode":"sync|async","conditions":[{"field":"attendance.workingHours","operator":"${OPERATORS.join('|')}","value":<string|number|boolean>,"valueType":"${VALUE_TYPES.join('|')}","logicalOperator":"AND|OR"}],"actions":[{"actionType":"${ACTION_TYPES.join('|')}","targetField":"...","value":...,"amount":number?,"percent":number?,"formula":"{attendance.overtimeHours} * 2"?,"notificationTemplate":"template_name"?,"notificationRecipients":"[\\"employee\\",\\"hr_manager\\"]"?}],"explanation":"plain-English summary of what this rule does"}}

Rules for conditions:
- value must match valueType (numbers as numbers, not strings, except when value is a string/enum like "Half Day" or "Sunday").
- Use logicalOperator "AND"/"OR" between multiple conditions (first condition has none).
- Mark Half Day => action {"actionType":"set","targetField":"attendance.status","value":"Half Day","valueType":"fixed"}
- Deduct a fixed amount from salary => {"actionType":"subtract","targetField":"salary.deductions","amount":500}
- Set a multiplier => {"actionType":"set","targetField":"salary.overtimeMultiplier","value":2}
- Send notification => {"actionType":"sendNotification","notificationTemplate":"<snake_case_name>","notificationRecipients":"[\\"employee\\"]"}

2. Instruction is vague or missing critical detail (e.g. threshold, amount, who to notify, which day):
{"status":"clarify","questions":[{"id":"q1","question":"...","type":"text|number|choice","options":["a","b"]?}]}

Ask at most 3 short questions. Currency amounts: if user writes ₹500 or Rs.500 use the number 500. Always "complete" when instruction contains explicit condition AND action.`;

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Gemini did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json(503, { error: 'GEMINI_API_KEY is not configured. Run: supabase secrets set GEMINI_API_KEY=<your key>' });
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash-lite';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json(401, { error: 'Authentication required' });

  const body = await request.json().catch(() => ({}));
  const instruction = String(body.instruction ?? '').trim();
  if (instruction.length < 8 || instruction.length > 4000) {
    return json(400, { error: 'Describe the rule in 8 to 4000 characters' });
  }
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : null;

  const answerBlock = answers
    ? `\n\nThe user answered your earlier clarifying questions:\n${JSON.stringify(answers)}`
    : '';
  const prompt = `${SYSTEM_PROMPT}\n\nInstruction:\n${instruction}${answerBlock}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return json(502, { error: `Gemini request failed: ${response.status}`, detail: detail.slice(0, 400) });
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || '';
  const usage = payload.usageMetadata ?? {};

  let parsed: any;
  try {
    parsed = extractJson(text);
  } catch {
    return json(502, { error: 'Gemini returned an unparseable response' });
  }

  // Persist to ai_rule_generation_history (best-effort — anon key RLS allows it).
  const historyRow = {
    natural_language_query: instruction,
    clarifying_questions: parsed.status === 'clarify' ? parsed.questions : null,
    user_answers: answers,
    ai_provider: 'gemini',
    model_used: model,
    tokens_used: Number(usage.totalTokenCount ?? 0),
    generated_rule: parsed.status === 'complete' ? parsed.rule : {},
    requested_by: user.email ?? 'unknown',
  };
  await supabase.from('ai_rule_generation_history').insert(historyRow);

  if (parsed.status === 'clarify') {
    if (!Array.isArray(parsed.questions) || !parsed.questions.length) {
      return json(502, { error: 'Gemini asked for clarification without questions' });
    }
    return json(200, { status: 'clarify', questions: parsed.questions.slice(0, 3) });
  }

  const rule = parsed.rule;
  const invalid =
    !rule || typeof rule.name !== 'string' || !rule.name.trim() ||
    !Array.isArray(rule.conditions) || !rule.conditions.length ||
    !Array.isArray(rule.actions) || !rule.actions.length ||
    rule.conditions.some((c: any) =>
      typeof c.field !== 'string' || !OPERATORS.includes(c.operator) || c.value === undefined) ||
    rule.actions.some((a: any) => !ACTION_TYPES.includes(a.actionType));
  if (invalid) return json(502, { error: 'Gemini returned an invalid rule structure', raw: rule });

  // Normalize
  rule.ruleType = RULE_TYPES.includes(rule.ruleType) ? rule.ruleType : 'custom';
  rule.executionMode = rule.executionMode === 'async' ? 'async' : 'sync';
  rule.priority = Number.isFinite(Number(rule.priority)) ? Math.min(100, Math.max(0, Number(rule.priority))) : 10;

  return json(200, { status: 'complete', rule });
});