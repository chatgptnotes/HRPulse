import { z } from 'zod';

const generatedRuleSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).default(''),
  ruleType: z.enum(['absence_threshold', 'late_coming', 'missed_swipe', 'early_leaving', 'escalation', 'custom']),
  conditions: z.record(z.unknown()),
  actions: z.record(z.unknown()),
  priority: z.number().int().min(0).max(999).default(0),
});

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Gemini did not return a JSON rule');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function generateRuleFromPolicy(policy: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured on the server');

  // Rule creation is a short, structured task, so use the lightweight model by
  // default. Set GEMINI_MODEL explicitly if the account exposes a different
  // model name.
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
  const prompt = `You create attendance rules for an HR system. Convert the policy below into exactly one JSON object.

Allowed ruleType values: absence_threshold, late_coming, missed_swipe, early_leaving, escalation, custom.
The conditions and actions must be JSON objects that can be evaluated by an HR rules engine. Do not invent fields outside the policy. Use actions such as templateType, severity, lopDays, lopMultiplier, notifyManager, notifyHRDirector, or disciplinaryRisk when appropriate.

Return JSON only with this shape:
{"name":"string","description":"string","ruleType":"custom","conditions":{},"actions":{},"priority":0}

Policy:
${policy}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) throw new Error(`Gemini request failed: ${response.status}`);
  const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  return generatedRuleSchema.parse(extractJson(text));
}
