"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import type { CampoImportador, Mapeo, ModoImportacion } from "./tipos";

/** Paso 2: un selector de columna por campo, más los botones Previsualizar y Aplicar. */
export function PasoMapeo<C extends string>({
  campos,
  columnas,
  mapeo,
  onCambiar,
  descripcion,
  children,
}: {
  campos: CampoImportador<C>[];
  /** Columnas del archivo leído. */
  columnas: string[];
  mapeo: Mapeo<C>;
  onCambiar: (mapeo: Mapeo<C>) => void;
  descripcion: string;
  /** Botones de envío (`BotonesImportar`). */
  children: React.ReactNode;
}) {
  return (
    <Card titulo="2. Mapeo de columnas" descripcion={descripcion}>
      <div className="grid gap-4 md:grid-cols-4">
        {campos.map(({ campo, etiqueta, opcional, hint }) => (
          <Field
            key={campo}
            label={opcional ? `${etiqueta} (opcional)` : etiqueta}
            hint={mapeo[campo] ? undefined : opcional ? hint : "Elige una columna"}
          >
            <Select value={mapeo[campo]} onChange={(e) => onCambiar({ ...mapeo, [campo]: e.target.value })}>
              <option value="">—</option>
              {columnas.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>
    </Card>
  );
}

/** Previsualizar (con el mapeo completo) y Aplicar (solo con una previsualización vigente y nada aplicado). */
export function BotonesImportar({
  mapeoCompleto,
  enviando,
  previaVigente,
  previaDesactualizada,
  aplicado,
  onEnviar,
}: {
  mapeoCompleto: boolean;
  enviando: ModoImportacion | null;
  previaVigente: boolean;
  /** Hubo una previsualización pero cambió el archivo o el mapeo. */
  previaDesactualizada: boolean;
  /** Ya se aplicó este archivo: Aplicar queda deshabilitado. */
  aplicado: boolean;
  onEnviar: (modo: ModoImportacion) => void;
}) {
  return (
    <>
      <Button onClick={() => onEnviar("previsualizar")} disabled={!mapeoCompleto || enviando !== null}>
        {enviando === "previsualizar" ? "Previsualizando…" : "Previsualizar"}
      </Button>
      <Button
        variante="secundario"
        onClick={() => onEnviar("aplicar")}
        disabled={!previaVigente || enviando !== null || aplicado}
        title={previaVigente ? undefined : "Primero previsualiza este archivo con este mapeo."}
      >
        {enviando === "aplicar" ? "Aplicando…" : "Aplicar"}
      </Button>
      {previaDesactualizada && (
        <span className="text-xs text-tinta-suave">Cambiaste el archivo o el mapeo: vuelve a previsualizar antes de aplicar.</span>
      )}
    </>
  );
}
