import { createClient } from '@supabase/supabase-js';

// Keep these as direct references so Vite replaces them at build time.
const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);
export const supabase = supabaseConfigured
  ? createClient(url!, anonKey!)
  : null;
