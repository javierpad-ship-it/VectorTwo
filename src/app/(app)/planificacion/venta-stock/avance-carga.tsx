"use client";

import { formatearNumero, plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { formatearDuracion, nombrePeriodo } from "./comunes";
import { segundosRestantes } from "./plan";
import { BarraProgreso } from "./progreso";
import type { AvanceMes, EstadoMesAvance } from "./use-carga-ventas";
import type { useCargaVentas } from "./use-carga-ventas";

const ETIQUETA: Record<EstadoMesAvance, string> = {
  pendiente: "Pendiente",
  cargando: "Cargando",
  publicado: "Publicado",
  saltado: "Saltado",
  error: "Error",
  cancelado: "Cancelado",
};

const TONO: Record<EstadoMesAvance, "neutro" | "marca" | "exito" | "alerta"> = {
  pendiente: "neutro",
  cargando: "marca",
  publicado: "exito",
  saltado: "neutro",
  error: "alerta",
  cancelado: "neutro",
};

/** Paso 6: avance de la carga mes a mes, con Cancelar y Reintentar los meses con error. */
export function AvanceCarga({ c }: { c: ReturnType<typeof useCargaVentas> }) {
  const avance = c.avance;
  if (!avance) return null;

  const incluidos = avance.meses.filter((m) => m.tandas > 0);
  const totalTandas = incluidos.reduce((s, m) => s + m.tandas, 0);
  const hechas = incluidos.reduce((s, m) => s + (m.estado === "publicado" || m.estado === "error" ? m.tandas : m.estado === "cargando" ? m.tandasHechas : 0), 0);
  const mesesHechos = incluidos.filter((m) => m.estado === "publicado" || m.estado === "error").length;
  const enMarcha = incluidos.find((m) => m.estado === "cargando");
  const fraccion = totalTandas === 0 ? 0 : hechas / totalTandas;
  const transcurrido = (avance.ahora - avance.inicio) / 1000;
  const restante = avance.activo ? segundosRestantes(transcurrido, hechas, totalTandas) : null;
  const publicados = avance.meses.filter((m) => m.estado === "publicado").length;
  const errores = avance.meses.filter((m) => m.estado === "error");

  const columnas: Columna<AvanceMes>[] = [
    { clave: "periodo", titulo: "Mes", render: (m) => <span className="whitespace-nowrap font-medium">{nombrePeriodo(m.periodo)}</span> },
    { clave: "estado", titulo: "Estado", render: (m) => <Badge tono={TONO[m.estado]}>{ETIQUETA[m.estado]}</Badge> },
    {
      clave: "tandas",
      titulo: "Tandas",
      className: "text-right font-mono",
      render: (m) => (m.tandas === 0 ? "—" : `${m.estado === "publicado" ? m.tandas : m.tandasHechas} / ${m.tandas}`),
    },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (m) => (m.tandas === 0 ? "—" : formatearNumero(m.filas)) },
    { clave: "detalle", titulo: "Detalle", render: (m) => <span className={m.estado === "error" ? "text-alerta" : "text-tinta-suave"}>{m.detalle}</span> },
  ];

  return (
    <Card
      titulo="6. Avance de la carga"
      descripcion="Cada mes es una carga independiente y se publica en cuanto termina: si algo se corta, los meses publicados se quedan y el mes en curso no se ve."
      acciones={
        avance.activo ? (
          <Button variante="peligro" tamano="sm" onClick={c.cancelarLaCarga} disabled={avance.cancelando}>
            {avance.cancelando ? "Cancelando…" : "Cancelar"}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {avance.error && <Alert>{avance.error}</Alert>}

        {!avance.error && (
          <div className="space-y-2" aria-live="polite">
            <p className="text-sm text-tinta">
              {avance.activo ? (
                <>
                  Mes {Math.min(mesesHechos + (enMarcha ? 1 : 0), incluidos.length)} de {incluidos.length}
                  {enMarcha && <> · {nombrePeriodo(enMarcha.periodo)}</>} · tanda {Math.min(hechas + (enMarcha ? 1 : 0), totalTandas)} de {totalTandas} ·{" "}
                  {Math.round(fraccion * 100)} %
                </>
              ) : (
                <>
                  {avance.cancelado ? "Carga cancelada" : "Carga terminada"}: {plural(publicados, "mes publicado", "meses publicados")}
                  {errores.length > 0 && <> y {plural(errores.length, "mes con error", "meses con error")}</>}.
                </>
              )}
            </p>
            <BarraProgreso fraccion={avance.activo ? fraccion : 1} etiqueta="Avance de la carga" />
            <p className="text-xs text-tinta-suave">
              Transcurrido: {formatearDuracion(transcurrido)}
              {restante !== null && avance.activo && <> · restante estimado: {formatearDuracion(restante)}</>}
              {avance.activo && " · no cierres esta pestaña mientras carga."}
            </p>
          </div>
        )}

        {!avance.activo && !avance.error && errores.length === 0 && publicados > 0 && (
          <Alert tono="exito">
            Listo. Los meses publicados ya se ven en «Cargas por mes».
          </Alert>
        )}
        {!avance.activo && errores.length > 0 && (
          <Alert>
            <span className="flex flex-wrap items-center gap-3">
              <span>
                {plural(errores.length, "mes no se cargó", "meses no se cargaron")}. La carga de cada uno se descartó y lo que ya estaba publicado sigue intacto; los demás meses sí se
                publicaron.
              </span>
              <Button tamano="sm" onClick={() => void c.reintentarConError()}>
                Reintentar los meses con error
              </Button>
            </span>
          </Alert>
        )}

        <DataTable columnas={columnas} filas={avance.meses} claveFila={(m) => m.periodo} claseFila={(m) => (m.estado === "error" ? "bg-alerta-suave/40" : undefined)} />
      </div>
    </Card>
  );
}
