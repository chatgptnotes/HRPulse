import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const allowedTypes = new Set(['absence_threshold', 'late_coming', 'missed_swipe', 'early_leaving', 'escalation', 'custom']);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Gemini did not return a JSON rule');
  return JSON.parse(cleaned.slice(start, end + 1));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json(401, { error: 'Authentication required' });

  const policy = String((await request.json()).policy ?? '').trim();
  if (policy.length < 10 || policy.length > 5000) return json(400, { error: 'Describe the policy in 10 to 5000 characters' });

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json(503, { error: 'GEMINI_API_KEY is not configured in Supabase Edge Function secrets' });
  const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.0-flash-lite';
  const prompt = `You create attendance rules for an HR system. Convert the policy below into exactly one JSON object.
Allowed ruleType values: absence_threshold, late_coming, missed_swipe, early_leaving, escalation, custom.
Return JSON only with this shape: {"name":"string","description":"string","ruleType":"custom","conditions":{},"actions":{},"priority":0}
Policy:\n${policy}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }),
  });
  if (!response.ok) return json(502, { error: `Gemini request failed: ${response.status}` });

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '';
  const rule = parseJson(text);
  if (typeof rule.name !== 'string' || !allowedTypes.has(rule.ruleType) || typeof rule.conditions !== 'object' || typeof rule.actions !== 'object') {
    return json(502, { error: 'Gemini returned an invalid rule' });
  }
  return json(200, { ...rule, description: String(rule.description ?? ''), priority: Number.isInteger(rule.priority) ? rule.priority : 0 });
});
