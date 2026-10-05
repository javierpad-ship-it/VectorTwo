"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";

/** Clave de localStorage donde se recuerda el correo en este equipo. */
const CLAVE_RECORDAR = "vector2.login.correo";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [recordar, setRecordar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Recupera el correo guardado. Se difiere un tick para no tocar el estado
  // de forma síncrona dentro del efecto (regla de hooks de React 19) y para
  // que el primer render coincida con el del servidor.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const guardado = window.localStorage.getItem(CLAVE_RECORDAR);
        if (guardado) {
          setEmail(guardado);
          setRecordar(true);
        }
      } catch {
        // localStorage bloqueado (modo privado, etc.): sin recordar.
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  function guardarPreferencia(correo: string, activo: boolean) {
    try {
      if (activo) window.localStorage.setItem(CLAVE_RECORDAR, correo);
      else window.localStorage.removeItem(CLAVE_RECORDAR);
    } catch {
      // sin localStorage no hay nada que guardar
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    const { error: err } = await supabaseBrowser().auth.signInWithPassword({ email, password });

    if (err) {
      setEnviando(false);
      setError(
        err.message.toLowerCase().includes("invalid")
          ? "Correo o contraseña incorrectos."
          : err.message
      );
      return;
    }

    guardarPreferencia(email.trim(), recordar);

    const destino = params.get("next");
    router.replace(destino && destino.startsWith("/") ? destino : "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-borde bg-superficie p-6 shadow-sm">
      <Field label="Correo">
        <Input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Contraseña">
        <div className="relative">
          <Input
            type={mostrar ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setMostrar((v) => !v)}
            aria-label={mostrar ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={mostrar}
            title={mostrar ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-tinta-suave hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-marca rounded-r-md"
          >
            {mostrar ? <IconoOjoTachado /> : <IconoOjo />}
          </button>
        </div>
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-tinta">
        <input
          type="checkbox"
          checked={recordar}
          onChange={(e) => {
            setRecordar(e.target.checked);
            if (!e.target.checked) guardarPreferencia("", false);
          }}
          className="h-4 w-4 rounded border-borde accent-marca"
        />
        Recordarme en este equipo
      </label>

      {error && <Alert>{error}</Alert>}
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando ? "Ingresando…" : "Ingresar"}
      </Button>
      <p className="text-xs text-tinta-suave">
        Con &quot;Recordarme&quot; el correo queda guardado en este equipo y la sesión se mantiene iniciada.
        La contraseña la puede guardar tu navegador cuando te lo ofrezca.
      </p>
    </form>
  );
}

function IconoOjo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconoOjoTachado() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.9 10.9 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a18.6 18.6 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
