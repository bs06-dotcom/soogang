import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function getSupabaseClient(accessToken?: string) {
  if (!url || !key) throw new Error("Supabase configuration is missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}

export function getBrowserSupabaseClient() {
  if (!url || !key) throw new Error("Supabase configuration is missing");
  return createClient(url, key);
}
