/**
 * Variables de entorno de Supabase. Solo tres, para que sea difícil
 * equivocarse al configurar Railway o `.env.local`:
 *
 *   NEXT_PUBLIC_SUPABASE_URL        URL del proyecto (pública)
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY   llave pública: anon (JWT) o sb_publishable_…
 *   SUPABASE_SERVICE_ROLE_KEY       llave secreta: service_role (JWT) o sb_secret_…
 *                                   NUNCA llega al navegador.
 */
export function supabaseUrl(): string {
  return requerida("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey(): string {
  return requerida(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function supabaseServiceRoleKey(): string {
  return requerida("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function requerida(nombre: string, valor: string | undefined): string {
  if (!valor) {
    throw new Error(
      `Falta la variable de entorno ${nombre}. Copia .env.local.example a .env.local y complétala.`
    );
  }
  return valor;
}
