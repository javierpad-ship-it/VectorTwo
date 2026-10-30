"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { BadgeEstadoProyeccion } from "./comunes";
import { textoCerradaMetodoAnterior } from "./crecimientos-vista";
import { crecimientosSinAprobarDe, enlaceCrecimientoGeneroMundo, formatearMomento, motivosCierreBloqueado, resumenCabecera, textoNoSePuedeCerrarPorCrecimientos, textoMotivoDesactualizada } from "./vista";

/**
 * Cabecera de la proyección abierta (ficha 07, pasos 0, 6 y 7): una línea con lo esencial (datos hasta, bloques de
 * tiendas por año, filas decididas, desvío del año anterior), el aviso de «desactualizada» con el motivo y Recalcular,
 * el aviso de cálculo en curso (las celdas no se editan mientras tanto) y las acciones sobre la proyección. Recalcular
 * rehace bloques, propuestas y curvas y conserva todas las decisiones. Desde 0.14.0 (06e) «Cerrar proyección» también se deshabilita, sin esperar
 * al `409`, mientras el Niño de `Y` no esté resuelto (`cierre_bloqueado_por`: 2027 marcado, factor faltante, desfasado o sin confirmar, factor o
 * agrupación que cambió) o haya crecimientos por reaprobar, y una cerrada de un método anterior avisa que M8 la sigue usando hasta el nuevo cierre.
 */
export function CabeceraProyeccion({
  proyeccion,
  calculandoLocal,
  ocupado,
  onRecalcular,
  onParametros,
  onCerrar,
  onArchivar,
  onEliminar,
  onCopiar,
}: {
  proyeccion: ProyeccionApi;
  calculandoLocal: boolean;
  ocupado: boolean;
  onRecalcular: () => void;
  onParametros: () => void;
  onCerrar: () => void;
  onArchivar: () => void;
  onEliminar: () => void;
  onCopiar: () => void;
}) {
  const enTrabajo = proyeccion.estado === "en_trabajo";
  const calculando = proyeccion.calculando || calculandoLocal;
  const piezas = resumenCabecera(proyeccion);
  // 06d: sin los crecimientos de HOMBRE y MUJER (y el Resto) aprobados no se puede cerrar, ni forzando: el botón se deshabilita con el motivo.
  const sinAprobar = crecimientosSinAprobarDe(proyeccion);
  const motivoSinAprobar = sinAprobar ? textoNoSePuedeCerrarPorCrecimientos(sinAprobar, proyeccion.anio_siguiente) : null;
  // 06e: el Niño de `Y` sin resolver tampoco deja cerrar (ni forzando).
  const motivosNino = motivosCierreBloqueado(proyeccion);
  const tituloCerrar = motivoSinAprobar ?? (motivosNino.length > 0 ? `No se puede cerrar: ${motivosNino[0].mensaje}` : undefined);
  const avisoMetodo = proyeccion.estado === "cerrada" ? textoCerradaMetodoAnterior(proyeccion.resumen?.version_metodo) : null;
  return (
    <div className="space-y-3 rounded-xl border border-borde bg-superficie px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <BadgeEstadoProyeccion estado={proyeccion.estado} />
            {proyeccion.estado === "cerrada" && <span className="text-xs text-tinta-suave">Cerrada el {formatearMomento(proyeccion.cerrada_at)}{proyeccion.cerrada_por_nombre ? ` por ${proyeccion.cerrada_por_nombre}` : ""} · solo lectura</span>}
            {proyeccion.estado === "archivada" && <span className="text-xs text-tinta-suave">Solo lectura</span>}
            {proyeccion.calculado_at && <span className="text-xs text-tinta-suave">Calculada el {formatearMomento(proyeccion.calculado_at)}</span>}
          </div>
          <p className="text-sm leading-relaxed text-tinta">{piezas.join(" · ")}</p>
          {proyeccion.nota && <p className="text-xs text-tinta-suave">Nota: {proyeccion.nota}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {enTrabajo && (
            <>
              <Button variante="secundario" tamano="sm" disabled={ocupado || calculando} onClick={onRecalcular}>
                {calculando ? "Calculando…" : "Recalcular"}
              </Button>
              <Button variante="secundario" tamano="sm" disabled={ocupado || calculando} onClick={onParametros}>
                Parámetros
              </Button>
              <Button tamano="sm" disabled={ocupado || calculando || sinAprobar !== null || motivosNino.length > 0} title={tituloCerrar} onClick={onCerrar}>
                Cerrar proyección
              </Button>
              <Button variante="fantasma" tamano="sm" disabled={ocupado || calculando} onClick={onArchivar}>
                Archivar
              </Button>
              <Button variante="peligro" tamano="sm" disabled={ocupado || calculando} onClick={onEliminar}>
                Eliminar
              </Button>
            </>
          )}
          {!enTrabajo && (
            <Button variante="secundario" tamano="sm" disabled={ocupado} onClick={onCopiar}>
              Copiar para seguir
            </Button>
          )}
          {proyeccion.estado === "cerrada" && (
            <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={onArchivar}>
              Archivar
            </Button>
          )}
        </div>
      </div>

      {enTrabajo && motivoSinAprobar && (
        <p className="text-xs text-alerta">
          {motivoSinAprobar}{" "}
          <Link href={enlaceCrecimientoGeneroMundo(proyeccion.anio_siguiente, proyeccion.id)} className="font-medium underline underline-offset-2">
            Ir a Crecimiento por género × mundo
          </Link>
        </p>
      )}

      {enTrabajo && motivosNino.length > 0 && (
        <ul className="space-y-1 text-xs text-alerta">
          {motivosNino.map((m) => (
            <li key={m.codigo}>
              {m.mensaje}
              {m.enlace && (
                <>
                  {" "}
                  <Link href={m.enlace.href} className="font-medium underline underline-offset-2">
                    {m.enlace.texto}
                  </Link>
                </>
              )}
              {m.recalcular && !m.enlace && <> Recalcula la proyección.</>}
            </li>
          ))}
        </ul>
      )}

      {avisoMetodo && <Alert tono="info">{avisoMetodo}</Alert>}

      {calculando && (
        <Alert tono="info">
          La proyección se está calculando{proyeccion.calculando_desde ? ` (desde ${formatearMomento(proyeccion.calculando_desde)})` : ""}. Mientras tanto no se puede editar; esta pantalla se actualiza sola al terminar.
        </Alert>
      )}
      {enTrabajo && !calculando && proyeccion.desactualizada.length > 0 && (
        <Alert tono="alerta">
          <span className="block font-medium">La proyección está desactualizada:</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {proyeccion.desactualizada.map((m, i) => (
              <li key={`${m.codigo}-${i}`}>
                {textoMotivoDesactualizada(m, proyeccion.anio_en_curso)}
                {m.codigo === "config_cambiada" && (
                  <>
                    {" "}
                    <Link href="/maestros/marcas" className="font-medium underline underline-offset-2">
                      Ver las marcas
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
          <span className="mt-2 block text-xs">Recalcular rehace propuestas, bloques y curvas y conserva todas tus decisiones; las que cambien de propuesta o de curva quedan marcadas.</span>
          <span className="mt-1 block">
            <button type="button" onClick={onRecalcular} disabled={ocupado} className="font-medium underline underline-offset-2 disabled:opacity-50">
              Recalcular ahora
            </button>
          </span>
        </Alert>
      )}
      {proyeccion.estado !== "en_trabajo" && proyeccion.desactualizada.length > 0 && <p className="text-xs text-tinta-suave">Se calculó con datos que después cambiaron; una proyección cerrada o archivada no se vuelve a calcular.</p>}
    </div>
  );
}
