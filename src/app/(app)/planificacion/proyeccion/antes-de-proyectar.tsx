"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { formatearNumero, plural } from "@/lib/formato";
import type { DatosProyeccionApi, Motivo, PrerrequisitosProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { CODIGOS_AVISO_NINO, enlaceDeAvisoNino, mesAaaaMm } from "./vista";

/**
 * Los avisos del Niño (factor sin calcular, desfasado o sin confirmar; 2027 marcado como atípico) no bloquean el cálculo pero sí el cierre: van con
 * tono de alerta y con el enlace de dónde se arreglan (06e §3.3). Los demás avisos conservan el tono de la lista.
 */
function ListaMotivos({ motivos, tono }: { motivos: readonly Motivo[]; tono: "alerta" | "info" }) {
  return (
    <ul className="space-y-1.5">
      {motivos.map((m, i) => (
        <li key={`${m.codigo}-${i}`}>
          <Alert tono={CODIGOS_AVISO_NINO.includes(m.codigo) ? "alerta" : tono}>
            <span className="block">{m.mensaje}</span>
            {enlaceDeAvisoNino(m.codigo) && (
              <span className="mt-1 block text-xs">
                <Link href={enlaceDeAvisoNino(m.codigo)!.href} className="font-medium underline underline-offset-2">
                  {enlaceDeAvisoNino(m.codigo)!.texto}
                </Link>
              </span>
            )}
            {m.detalle && m.detalle.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {m.detalle.slice(0, 12).map((d) => (
                  <li key={d}>{d}</li>
                ))}
                {m.detalle.length > 12 && <li>… y {m.detalle.length - 12} más</li>}
              </ul>
            )}
          </Alert>
        </li>
      ))}
    </ul>
  );
}

/**
 * «Antes de proyectar» (ficha 07, paso 0): lo que M5 y M6 dejan listo para proyectar. Bloquea sin meses publicados, con un
 * mes faltante dentro del año en curso o de la ventana de doce meses, con una tienda con venta sin fecha de apertura o sin
 * ninguna tienda en las mismas tiendas; avisa lo demás (aperturas dudosas, agrupaciones sin curva, curvas obsoletas,
 * tiendas nuevas sin venta esperada o sin referente…). Se abre sola si algo bloquea.
 */
export function AntesDeProyectar({
  datos,
  prerrequisitos,
  abierta,
  curvasUsuario = 0,
}: {
  datos: DatosProyeccionApi;
  prerrequisitos: PrerrequisitosProyeccionApi;
  abierta?: boolean;
  /** 06c: agrupaciones cuya curva vigente es del usuario (`origen_curva = "usuario"`); nunca cuentan como obsoletas. */
  curvasUsuario?: number;
}) {
  const { bloquea, avisa } = prerrequisitos;
  const abrir = abierta ?? bloquea.length > 0;
  return (
    <details open={abrir} className="rounded-xl border border-borde bg-superficie shadow-sm">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
        <span className="text-base font-semibold">Antes de proyectar</span>
        {bloquea.length > 0 ? (
          <span className="font-medium text-alerta">{plural(bloquea.length, "bloqueo", "bloqueos")}</span>
        ) : (
          <span className="font-medium text-exito">Nada bloquea</span>
        )}
        {avisa.length > 0 && <span className="text-tinta-suave">{plural(avisa.length, "aviso", "avisos")}</span>}
      </summary>
      <div className="space-y-4 border-t border-borde px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-tinta-suave">Meses publicados (M5)</dt>
            <dd>
              {datos.desde && datos.hasta ? `${mesAaaaMm(datos.desde)} a ${mesAaaaMm(datos.hasta)} (${formatearNumero(datos.meses_publicados.length)})` : "ninguno"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-tinta-suave">Último mes cerrado</dt>
            <dd>{datos.ultimo_mes_cerrado ? mesAaaaMm(datos.ultimo_mes_cerrado) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-tinta-suave">Curvas vigentes (M6)</dt>
            <dd>
              {formatearNumero(datos.curvas_vigentes)}
              {datos.curvas_obsoletas > 0 && <span className="text-alerta"> · {datos.curvas_obsoletas} obsoletas</span>}
            </dd>
            {curvasUsuario > 0 && (
              <dd className="mt-0.5 text-xs text-tinta-suave">
                {plural(curvasUsuario, "agrupación con curva del usuario", "agrupaciones con curva del usuario")} (no se marcan obsoletas; vigilarlas desde Curvas de estacionalidad)
              </dd>
            )}
          </div>
          <div>
            <dt className="text-xs text-tinta-suave">Agrupaciones con venta sin curva</dt>
            <dd className={datos.agrupaciones_sin_curva.length > 0 ? "text-alerta" : undefined}>
              {datos.agrupaciones_sin_curva.length === 0 ? "ninguna" : datos.agrupaciones_sin_curva.map((a) => a.nombre).join(", ")}
            </dd>
          </div>
        </dl>
        {datos.meses_faltantes.length > 0 && <p className="text-xs text-tinta-suave">Meses sin publicar entre el primero y el último: {datos.meses_faltantes.map(mesAaaaMm).join(", ")}.</p>}
        {bloquea.length > 0 && <ListaMotivos motivos={bloquea} tono="alerta" />}
        {avisa.length > 0 && <ListaMotivos motivos={avisa} tono="info" />}
        {bloquea.length === 0 && avisa.length === 0 && <p className="text-sm text-tinta-suave">Todo está listo para proyectar.</p>}
      </div>
    </details>
  );
}
