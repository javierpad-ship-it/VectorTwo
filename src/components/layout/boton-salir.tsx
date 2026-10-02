"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";

export function BotonSalir({
  variante = "fantasma",
  className = "",
}: {
  variante?: "fantasma" | "secundario";
  className?: string;
}) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button variante={variante} tamano="sm" onClick={salir} disabled={saliendo} className={className}>
      {saliendo ? "Saliendo…" : "Cerrar sesión"}
    </Button>
  );
}
