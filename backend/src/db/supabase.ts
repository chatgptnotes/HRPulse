import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const backendEnvPath = path.basename(process.cwd()).toLowerCase() === 'backend'
  ? path.resolve(process.cwd(), '.env')
  : path.resolve(process.cwd(), 'backend', '.env');
dotenv.config({ path: backendEnvPath });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — database calls will fail.'
  );
}

// Client is untyped (no generated Database schema); cast to any so all filter
// builders (.in, .or, .not.in, etc.) are available without per-column generics.
export const supabase: any = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function getSettings(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('settings').select('key, value');
  if (error) throw new Error(`getSettings: ${error.message}`);
  return Object.fromEntries((data || []).map((r: { key: string; value: string }) => [r.key, r.value]));
}

export default supabase;
