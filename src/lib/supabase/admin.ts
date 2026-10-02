import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabaseServiceRoleKey, supabaseUrl } from "./env";

let cliente: SupabaseClient<Database> | null = null;

/**
 * Cliente de servidor con la llave service_role: salta el RLS y accede a
 * Auth Admin. Solo se importa desde route handlers y server components;
 * nunca desde un componente "use client".
 */
export function supabaseAdmin(): SupabaseClient<Database> {
  if (cliente) return cliente;
  cliente = createClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cliente;
}
