"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

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
        <Input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
