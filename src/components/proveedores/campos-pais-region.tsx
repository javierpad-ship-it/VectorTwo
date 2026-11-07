"use client";

import { Field, Input, Select } from "@/components/ui/form";
import { PAIS_EEUU, PAISES } from "@/lib/proveedores/paises";
import { ESTADOS_EEUU } from "@/lib/proveedores/regiones";

/**
 * País (lista) y estado o provincia (08c, §2.1, R14): con Estados Unidos el estado sale de la lista y es obligatorio; con otro país es
 * texto libre (en China la provincia también importa). Al cambiar de país se limpia una región que ya no corresponde.
 */
export function CamposPaisRegion({
  pais,
  region,
  errorPais,
  errorRegion,
  deshabilitado = false,
  onCambiar,
}: {
  pais: string;
  region: string;
  errorPais?: string;
  errorRegion?: string;
  deshabilitado?: boolean;
  onCambiar: (cambio: { pais: string; region: string }) => void;
}) {
  const esEeuu = pais === PAIS_EEUU;
  return (
    <>
      <Field label="País *" error={errorPais}>
        <Select
          value={pais}
          disabled={deshabilitado}
          aria-invalid={Boolean(errorPais)}
          onChange={(e) => {
            const nuevo = e.target.value;
            // Al pasar a EE. UU. o salir de él, la región anterior no sirve.
            const conservar = (nuevo === PAIS_EEUU) === esEeuu;
            onCambiar({ pais: nuevo, region: conservar ? region : "" });
          }}
        >
          <option value="">Elige un país…</option>
          {PAISES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={esEeuu ? "Estado *" : "Estado o provincia"} error={errorRegion}>
        {esEeuu ? (
          <Select value={region} disabled={deshabilitado} aria-invalid={Boolean(errorRegion)} onChange={(e) => onCambiar({ pais, region: e.target.value })}>
            <option value="">Elige un estado…</option>
            {ESTADOS_EEUU.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        ) : (
          <Input value={region} maxLength={80} disabled={deshabilitado} aria-invalid={Boolean(errorRegion)} onChange={(e) => onCambiar({ pais, region: e.target.value })} placeholder="Guangdong, Zhejiang…" />
        )}
      </Field>
    </>
  );
}
