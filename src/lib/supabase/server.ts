import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Cliente ligado a la sesión del usuario que hace la petición (lee las
 * cookies que deja @supabase/ssr). Sirve para saber QUIÉN llama; respeta
 * RLS, así que para leer o escribir datos se usa `supabaseAdmin()`.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Llamado desde el render de un Server Component: no se pueden
          // escribir cookies ahí. No pasa nada: el proxy refresca la sesión
          // en cada petición.
        }
      },
    },
  });
}
