"use client";

import { useMemo } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatearNumero, plural } from "@/lib/formato";
import { AvanceCarga } from "./avance-carga";
import { nombrePeriodo } from "./comunes";
import { LecturaCard } from "./lectura-card";
import { PasoArchivoVenta } from "./paso-archivo-venta";
import { ETIQUETA_SALTO, planificarCarga, type PlanCarga } from "./plan";
import { ReportePrevio } from "./reporte-previo";
import { useCargaVentas } from "./use-carga-ventas";

/**
 * Pestaña Cargar: 1 Archivo · 2 Mapeo · 3 Lectura · 4 Reporte previo ·
 * 5 Cargar · 6 Avance. Un solo botón de acción visible por paso.
 */
export function CargarTab({ onPublicado }: { onPublicado: () => void }) {
  const c = useCargaVentas({ onPublicado });
  const { prevVigente, informe } = c;

  const plan = useMemo(() => (informe ? planificarCarga(informe, c.opciones) : null), [informe, c.opciones]);
  const hayBloqueados = informe?.meses.some((m) => m.bloqueado) ?? false;
  const hayIdenticos = informe?.meses.some((m) => m.estado === "identico") ?? false;

  const nuevasSinAgrupacion =
    prevVigente !== null && informe !== null && informe.marcas_nuevas.some((m) => !m.comodin) && c.agrupacionMarcaId === "";
  const sinIdentidad = plan?.cargar.filter((m) => !m.identidad_ok) ?? [];

  const razones: string[] = [];
  if (informe?.bloqueado_global) razones.push("El archivo tiene un diagnóstico que bloquea la carga (arriba, en rojo).");
  if (plan && plan.cargar.length === 0) razones.push("No hay ningún mes para cargar con las opciones elegidas.");
  if (sinIdentidad.length > 0) razones.push(`La identidad archivo = cargado + excluido no cierra en ${sinIdentidad.map((m) => nombrePeriodo(m.periodo)).join(", ")}.`);
  if (nuevasSinAgrupacion) razones.push("Elige la agrupación de las marcas nuevas.");
  const puedeCargar = prevVigente !== null && plan !== null && razones.length === 0 && !c.cargando && !c.leyendo;

  function textoConfirmar(p: PlanCarga): string {
    const nombre = prevVigente?.archivoNombre ?? "el archivo";
    const lineas = [`¿Cargar ${plural(p.cargar.length, "mes", "meses")} de ${nombre}?`];
    const filas = p.cargar.reduce((s, m) => s + m.cargado.filas, 0);
    lineas.push(`Se cargan ${formatearNumero(filas)} filas (${p.cargar.map((m) => nombrePeriodo(m.periodo)).join(", ")}).`);
    const reemplazan = p.cargar.filter((m) => m.publicada !== null);
    if (reemplazan.length > 0) {
      lineas.push(
        `\nReemplazan una carga existente: ${reemplazan.map((m) => `${nombrePeriodo(m.periodo)} (${formatearNumero(m.publicada?.filas ?? 0)} filas)`).join(", ")}.`
      );
    }
    const abiertos = p.cargar.filter((m) => m.abierto);
    if (abiertos.length > 0) lineas.push(`\nMes todavía abierto (su venta está incompleta): ${abiertos.map((m) => nombrePeriodo(m.periodo)).join(", ")}.`);
    const forzados = p.cargar.filter((m) => m.bloqueado);
    if (forzados.length > 0) lineas.push(`\nSe cargan como Incompleto (errores de 2 % o más): ${forzados.map((m) => nombrePeriodo(m.periodo)).join(", ")}.`);
    const fuera = p.cargar.reduce((s, m) => s + m.excluido.filas, 0);
    if (fuera > 0) lineas.push(`\nQuedan fuera ${plural(fuera, "fila", "filas")} excluidas de esos meses.`);
    if (p.saltados.length > 0) {
      const omitidos = p.saltados.map((s) => `${nombrePeriodo(s.mes.periodo)} (${ETIQUETA_SALTO[s.motivo].toLowerCase()})`);
      lineas.push(`\nSe omiten: ${omitidos.join(", ")}.`);
    }
    const nuevas = informe?.marcas_nuevas.length ?? 0;
    if (nuevas > 0) lineas.push(`\nSe crearán ${plural(nuevas, "marca nueva", "marcas nuevas")}.`);
    return lineas.join("\n");
  }

  return (
    <div className="space-y-6">
      {c.error && <Alert onCerrar={() => c.setError(null)}>{c.error}</Alert>}

      <PasoArchivoVenta c={c} />
      <LecturaCard c={c} />

      {prevVigente && informe && plan && !c.leyendo && (
        <>
          <ReportePrevio c={c} informe={informe} prev={prevVigente} />

          <Card titulo="5. Cargar" descripcion="Cada mes se carga como una carga independiente y reemplaza al mes publicado, si lo hay; recién se ve cuando termina y concilia con la base.">
            <div className="space-y-4">
              <div className="space-y-3">
                {hayIdenticos && (
                  <Switch
                    checked={c.opciones.saltarIdenticos}
                    onChange={(v) => c.setOpciones({ ...c.opciones, saltarIdenticos: v })}
                    label="Saltar los meses ya cargados con los mismos totales"
                  />
                )}
                {hayBloqueados && (
                  <Switch
                    checked={c.opciones.forzarBloqueados}
                    onChange={(v) => c.setOpciones({ ...c.opciones, forzarBloqueados: v })}
                    label="Cargar también los meses bloqueados (quedarán marcados Incompleto)"
                  />
                )}
              </div>

              <p className="text-sm text-tinta-suave">
                Se {plan.cargar.length === 1 ? "cargará" : "cargarán"} <strong className="text-tinta">{plural(plan.cargar.length, "mes", "meses")}</strong>
                {plan.saltados.length > 0 && <> y se {plan.saltados.length === 1 ? "omite" : "omiten"} {plan.saltados.length}</>}.
              </p>

              {razones.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-alerta">
                  {razones.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}

              <Button onClick={() => void c.cargar(textoConfirmar)} disabled={!puedeCargar}>
                {c.cargando ? "Cargando…" : `Cargar ${plural(plan.cargar.length, "mes", "meses")}`}
              </Button>
            </div>
          </Card>
        </>
      )}

      <AvanceCarga c={c} />
    </div>
  );
}
